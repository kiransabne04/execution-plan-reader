import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { matchNodes, PlanComparisonError, summarizeMatches } from "../matchNodes"
import { parsePostgresTextPlan } from "../../parsers/postgres/textParser"
import { makeNode } from "./testHelpers"

function loadFixture(engineDir: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engineDir}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

/** Two independently "captured" versions of the same simple join query:
 * `hash_join` over a seq scan on `orders` and a seq scan on `customers`.
 * `idPrefix` keeps node ids distinct across the two sides, the way two real
 * plan captures would never share an id scheme. */
function buildJoinPlan(idPrefix: string, opts: { scanOrder?: ["orders", "customers"] | ["customers", "orders"] } = {}) {
  const order = opts.scanOrder ?? ["orders", "customers"]
  const scans = order.map((relation, i) =>
    makeNode({
      id: `${idPrefix}-scan-${relation}`,
      operatorType: "seq_scan",
      rawOperatorLabel: "Seq Scan",
      attributes: { "Relation Name": relation },
      actualRows: i === 0 ? 1000 : 500,
    }),
  )
  return makeNode({
    id: `${idPrefix}-join`,
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Join",
    children: scans,
  })
}

describe("matchNodes", () => {
  it("matches an identical plan against a fresh capture of itself: 100% matched, zero changed/added/removed", () => {
    const planA = buildJoinPlan("a")
    const planB = buildJoinPlan("b")
    const matches = matchNodes(planA, planB)

    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.status === "matched")).toBe(true)
    expect(matches.every((m) => m.nodeIdA !== undefined && m.nodeIdB !== undefined)).toBe(true)
  })

  it("regression floor: matching a plan against the exact same object is always 100% matched", () => {
    const plan = buildJoinPlan("x")
    const matches = matchNodes(plan, plan)
    expect(matches.every((m) => m.status === "matched")).toBe(true)
    expect(matches.filter((m) => m.status !== "matched")).toHaveLength(0)
  })

  it("index added: same relation, operator type changes seq_scan -> index_scan -> reported as changed, not added+removed", () => {
    const planA = makeNode({
      id: "a-scan",
      operatorType: "seq_scan",
      rawOperatorLabel: "Seq Scan",
      attributes: { "Relation Name": "orders" },
    })
    const planB = makeNode({
      id: "b-scan",
      operatorType: "index_scan",
      rawOperatorLabel: "Index Scan",
      attributes: { "Relation Name": "orders", "Index Name": "idx_orders_customer_id" },
      index: { name: "idx_orders_customer_id" },
    })

    const matches = matchNodes(planA, planB)
    expect(matches).toEqual([{ status: "changed", nodeIdA: "a-scan", nodeIdB: "b-scan" }])
  })

  it("index added AND position shifted together: relation identity alone must carry the match, since neither operator type nor position agree", () => {
    // Proves phase 2 (relation identity) is what resolves this, not an
    // accidental phase-3 position coincidence: the orders scan moves from
    // ordinal 0 to ordinal 1 *and* changes seq_scan -> index_scan.
    const planA = makeNode({
      id: "a-join",
      operatorType: "hash_join",
      children: [
        makeNode({ id: "a-scan-orders", operatorType: "seq_scan", attributes: { "Relation Name": "orders" } }),
        makeNode({ id: "a-scan-customers", operatorType: "seq_scan", attributes: { "Relation Name": "customers" } }),
      ],
    })
    const planB = makeNode({
      id: "b-join",
      operatorType: "hash_join",
      children: [
        makeNode({ id: "b-scan-customers", operatorType: "seq_scan", attributes: { "Relation Name": "customers" } }),
        makeNode({
          id: "b-scan-orders",
          operatorType: "index_scan",
          attributes: { "Relation Name": "orders", "Index Name": "idx_orders_customer_id" },
          index: { name: "idx_orders_customer_id" },
        }),
      ],
    })

    const matches = matchNodes(planA, planB)
    const ordersMatch = matches.find((m) => m.nodeIdA === "a-scan-orders")
    expect(ordersMatch).toEqual({ status: "changed", nodeIdA: "a-scan-orders", nodeIdB: "b-scan-orders" })
    expect(matches.filter((m) => m.status === "addedInB" || m.status === "removedFromB")).toHaveLength(0)
  })

  it("join order changed: structural position shifts but relation identity persists -> still matched, not changed", () => {
    const planA = buildJoinPlan("a", { scanOrder: ["orders", "customers"] })
    const planB = buildJoinPlan("b", { scanOrder: ["customers", "orders"] })

    const matches = matchNodes(planA, planB)
    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.status === "matched")).toBe(true)

    const ordersMatch = matches.find((m) => m.nodeIdA === "a-scan-orders")
    expect(ordersMatch?.nodeIdB).toBe("b-scan-orders")
    const customersMatch = matches.find((m) => m.nodeIdA === "a-scan-customers")
    expect(customersMatch?.nodeIdB).toBe("b-scan-customers")
  })

  it("table added: a genuinely new relation on the B side has no correspondence in A -> addedInB", () => {
    const planA = buildJoinPlan("a")
    const planB = makeNode({
      id: "b-join",
      operatorType: "hash_join",
      rawOperatorLabel: "Hash Join",
      children: [
        makeNode({ id: "b-scan-orders", operatorType: "seq_scan", attributes: { "Relation Name": "orders" } }),
        makeNode({ id: "b-scan-customers", operatorType: "seq_scan", attributes: { "Relation Name": "customers" } }),
        makeNode({ id: "b-scan-regions", operatorType: "seq_scan", attributes: { "Relation Name": "regions" } }),
      ],
    })

    const matches = matchNodes(planA, planB)
    const added = matches.filter((m) => m.status === "addedInB")
    expect(added).toEqual([{ status: "addedInB", nodeIdA: undefined, nodeIdB: "b-scan-regions" }])
    expect(matches.filter((m) => m.status === "removedFromB")).toHaveLength(0)
  })

  it("table removed: a relation present in A and absent from B -> removedFromB", () => {
    const planA = makeNode({
      id: "a-join",
      operatorType: "hash_join",
      children: [
        makeNode({ id: "a-scan-orders", operatorType: "seq_scan", attributes: { "Relation Name": "orders" } }),
        makeNode({ id: "a-scan-regions", operatorType: "seq_scan", attributes: { "Relation Name": "regions" } }),
      ],
    })
    const planB = makeNode({
      id: "b-join",
      operatorType: "hash_join",
      children: [makeNode({ id: "b-scan-orders", operatorType: "seq_scan", attributes: { "Relation Name": "orders" } })],
    })

    const matches = matchNodes(planA, planB)
    const removed = matches.filter((m) => m.status === "removedFromB")
    expect(removed).toEqual([{ status: "removedFromB", nodeIdA: "a-scan-regions", nodeIdB: undefined }])
  })

  it("positional-only fallback: nodes with no relation/index identity match on depth+ordinal alone", () => {
    const planA = makeNode({ id: "a-sort", operatorType: "sort", rawOperatorLabel: "Sort" })
    const planB = makeNode({ id: "b-agg", operatorType: "aggregate", rawOperatorLabel: "Aggregate" })

    const matches = matchNodes(planA, planB)
    expect(matches).toEqual([{ status: "changed", nodeIdA: "a-sort", nodeIdB: "b-agg" }])
  })

  it("rejects a cross-engine comparison with a clear, specific message instead of forcing a match", () => {
    const planA = makeNode({ engine: "postgres", operatorType: "seq_scan" })
    const planB = makeNode({ engine: "sqlserver", operatorType: "seq_scan" })

    expect(() => matchNodes(planA, planB)).toThrow(PlanComparisonError)
    try {
      matchNodes(planA, planB)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanComparisonError)
      expect((err as PlanComparisonError).code).toBe("CROSS_ENGINE")
      expect((err as PlanComparisonError).message).toMatch(/different database engines/)
    }
  })

  it("CTE/subplan present in one plan but inlined in the other: reported as addedInB/removedFromB, not forced into a match", () => {
    // role: "sub" mirrors how Postgres SubPlan/InitPlan nodes are tagged
    // (see PlanNodeRole in src/parsers/normalize.ts) — a second query shape
    // where a subplan branch was inlined away rather than kept as-is.
    const planA = makeNode({
      id: "a-scan",
      operatorType: "seq_scan",
      attributes: { "Relation Name": "orders" },
      children: [makeNode({ id: "a-subplan", operatorType: "seq_scan", role: "sub", attributes: { "Relation Name": "discount_codes" } })],
    })
    const planB = makeNode({
      id: "b-scan",
      operatorType: "seq_scan",
      attributes: { "Relation Name": "orders" },
    })

    const matches = matchNodes(planA, planB)
    expect(matches).toContainEqual({ status: "removedFromB", nodeIdA: "a-subplan", nodeIdB: undefined })
    expect(matches.find((m) => m.nodeIdA === "a-scan")).toEqual({ status: "matched", nodeIdA: "a-scan", nodeIdB: "b-scan" })
  })

  it("large plans (150+ nodes per side): stays fast via hash-based lookups, not a naive O(n·m) scan", () => {
    const buildWideTree = (idPrefix: string, count: number) =>
      makeNode({
        id: `${idPrefix}-root`,
        operatorType: "hash_join",
        children: Array.from({ length: count }, (_, i) =>
          makeNode({ id: `${idPrefix}-scan-${i}`, operatorType: "seq_scan", attributes: { "Relation Name": `table_${i}` } }),
        ),
      })
    const planA = buildWideTree("a", 200)
    const planB = buildWideTree("b", 200)

    const start = performance.now()
    const matches = matchNodes(planA, planB)
    const elapsed = performance.now() - start

    expect(matches.every((m) => m.status === "matched")).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })

  it("real parser round trip: a Postgres text plan matched against a fresh parse of itself is 100% matched", () => {
    const text = loadFixture("postgres", "simple-seq-scan-text.txt")
    const planA = parsePostgresTextPlan(text)
    const planB = parsePostgresTextPlan(text)

    const matches = matchNodes(planA, planB)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.status === "matched")).toBe(true)
  })
})

describe("summarizeMatches", () => {
  it("computes counts and a matched+changed ratio against the larger side", () => {
    const summary = summarizeMatches([
      { status: "matched", nodeIdA: "1", nodeIdB: "1" },
      { status: "changed", nodeIdA: "2", nodeIdB: "2" },
      { status: "addedInB", nodeIdB: "3" },
      { status: "removedFromB", nodeIdA: "4" },
    ])
    expect(summary).toMatchObject({ matchedCount: 1, changedCount: 1, addedCount: 1, removedCount: 1 })
    // totalA = matched+changed+removed = 3, totalB = matched+changed+added = 3
    expect(summary.matchRatio).toBeCloseTo(2 / 3)
    expect(summary.lowConfidence).toBe(false)
  })

  it("flags low confidence when the match ratio falls below the threshold — likely unrelated queries", () => {
    const summary = summarizeMatches([
      { status: "matched", nodeIdA: "1", nodeIdB: "1" },
      { status: "removedFromB", nodeIdA: "2" },
      { status: "removedFromB", nodeIdA: "3" },
      { status: "addedInB", nodeIdB: "4" },
      { status: "addedInB", nodeIdB: "5" },
    ])
    expect(summary.lowConfidence).toBe(true)
  })

  it("treats an empty match list as a full ratio, not a division-by-zero NaN", () => {
    const summary = summarizeMatches([])
    expect(summary.matchRatio).toBe(1)
    expect(summary.lowConfidence).toBe(false)
  })
})
