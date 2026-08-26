import { describe, expect, it } from "vitest"
import { parsePostgresTextPlan } from "../textParser"
import { parsePostgresJsonPlan } from "../parseJsonPlan"
import { PlanParseError, collectNodes, type PlanNode } from "../../normalize"
import { loadFixture } from "./testUtils"

function countNodes(node: PlanNode): number {
  return collectNodes(node).length
}

const collect = collectNodes

/** Core normalized shape only — attributes bags legitimately differ in
 * per-field type/coverage between JSON and TEXT (e.g. "Startup Cost" is a
 * number straight off JSON but a formatted string parsed out of TEXT), so
 * parity is about tree shape and the promoted PlanNode fields, not a
 * byte-identical attributes bag. */
function comparableShape(node: PlanNode): unknown {
  return {
    rawOperatorLabel: node.rawOperatorLabel,
    operatorType: node.operatorType,
    estimatedRows: node.estimatedRows,
    estimatedCost: node.estimatedCost,
    actualTimeMs: node.actualTimeMs,
    actualRows: node.actualRows,
    loops: node.loops,
    role: node.role,
    children: node.children.map(comparableShape),
  }
}

describe("parsePostgresTextPlan", () => {
  it("parses a single-node plan and maps all standard fields", () => {
    const root = parsePostgresTextPlan(loadFixture("simple-seq-scan-text.txt"))
    expect(root.rawOperatorLabel).toBe("Seq Scan")
    expect(root.operatorType).toBe("seq_scan")
    expect(root.attributes["Relation Name"]).toBe("users")
    expect(root.estimatedRows).toBe(1200)
    expect(root.estimatedCost).toBe(22.0)
    expect(root.actualTimeMs).toBe(0.045)
    expect(root.actualRows).toBe(1180)
    expect(root.loops).toBe(1)
    expect(root.role).toBe("main")
    expect(root.children).toEqual([])
    expect(root.attributes["Planning Time"]).toBe("0.123 ms")
    expect(root.attributes["Execution Time"]).toBe("0.089 ms")
  })

  it("reconstructs a nested tree of matching depth/order from indentation and ->", () => {
    const root = parsePostgresTextPlan(loadFixture("multi-way-join-text.txt"))
    expect(root.rawOperatorLabel).toBe("Hash Join")
    expect(root.attributes["Join Type"]).toBe("Inner")
    expect(root.attributes["Hash Cond"]).toBe("(orders.customer_id = customers.id)")
    expect(root.children).toHaveLength(2)
    expect(root.children[0].rawOperatorLabel).toBe("Seq Scan")
    expect(root.children[0].attributes["Relation Name"]).toBe("orders")
    expect(root.children[1].rawOperatorLabel).toBe("Hash")
    expect(root.children[1].children).toHaveLength(1)
    expect(root.children[1].children[0].attributes["Relation Name"]).toBe("customers")
    expect(countNodes(root)).toBe(4)
  })

  it("tags InitPlan/SubPlan nodes with a distinct role, matching the JSON parser's model", () => {
    const root = parsePostgresTextPlan(loadFixture("initplan-subplan-text.txt"))
    const all = collect(root)
    const init = all.find((n) => n.attributes["Subplan Name"] === "InitPlan 1 (returns $0)")
    const sub = all.find((n) => n.attributes["Subplan Name"] === "SubPlan 2")
    expect(init?.role).toBe("init")
    expect(init?.rawOperatorLabel).toBe("Aggregate")
    expect(sub?.role).toBe("sub")
    expect(sub?.rawOperatorLabel).toBe("Index Scan")
    expect(sub?.attributes["Index Name"]).toBe("orders_region_idx")
  })

  it("does not crash without ANALYZE and leaves actual* undefined", () => {
    const root = parsePostgresTextPlan(loadFixture("estimate-only-plan-text.txt"))
    for (const node of collect(root)) {
      expect(node.actualTimeMs).toBeUndefined()
      expect(node.actualRows).toBeUndefined()
      expect(node.loops).toBeUndefined()
      expect(node.estimatedCost).toBeDefined()
    }
  })

  it("unwraps psql \\x on RECORD-mode captures identically to the plain form", () => {
    const viaRecordMode = parsePostgresTextPlan(loadFixture("psql-record-mode.txt"))
    const viaPlain = parsePostgresTextPlan(loadFixture("simple-seq-scan-text.txt"))
    expect(comparableShape(viaRecordMode)).toEqual(comparableShape(viaPlain))
  })

  it("strips the QUERY PLAN header, dashed underline, and (N rows) footer", () => {
    const viaHeaderFooter = parsePostgresTextPlan(loadFixture("psql-header-and-footer.txt"))
    const viaPlain = parsePostgresTextPlan(loadFixture("simple-seq-scan-text.txt"))
    expect(comparableShape(viaHeaderFooter)).toEqual(comparableShape(viaPlain))
  })

  it("strips an auto_explain LOG:/timestamp preamble before the real plan", () => {
    const root = parsePostgresTextPlan(loadFixture("auto-explain-text-capture.txt"))
    expect(root.rawOperatorLabel).toBe("Seq Scan")
    expect(root.attributes["Relation Name"]).toBe("users")
    expect(root.attributes["Planning Time"]).toBe("0.123 ms")
  })

  it("only treats -> as a tree marker at line-start, not inside detail-line text", () => {
    const root = parsePostgresTextPlan(loadFixture("query-text-with-arrow-operator.txt"))
    expect(root.children).toEqual([])
    expect(root.attributes["Filter"]).toContain("->")
  })

  it("throws NOT_A_PLAN for pasted non-plan text, without echoing raw content", () => {
    try {
      parsePostgresTextPlan(loadFixture("non-plan-text.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("NOT_A_PLAN")
      expect(e.message).not.toContain("SELECT")
    }
  })

  it("throws TRUNCATED_INPUT for a cut-off paste, without echoing raw content", () => {
    try {
      parsePostgresTextPlan(loadFixture("truncated-plan-text.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("TRUNCATED_INPUT")
      expect(e.message).not.toContain("Hash Join")
    }
  })

  it("throws EMPTY_INPUT on empty/whitespace-only input", () => {
    try {
      parsePostgresTextPlan("   \n  ")
      expect.unreachable()
    } catch (err) {
      expect((err as PlanParseError).code).toBe("EMPTY_INPUT")
    }
  })

  describe("parity with the JSON parser on equivalent plans", () => {
    const pairs: Array<[string, string]> = [
      ["simple-seq-scan-text.txt", "simple-seq-scan.json"],
      ["multi-way-join-text.txt", "multi-way-join.json"],
      ["initplan-subplan-text.txt", "initplan-subplan.json"],
      ["estimate-only-plan-text.txt", "estimate-only-plan.json"],
    ]

    for (const [textFixture, jsonFixture] of pairs) {
      it(`${textFixture} <-> ${jsonFixture}`, () => {
        const fromText = parsePostgresTextPlan(loadFixture(textFixture))
        const fromJson = parsePostgresJsonPlan(loadFixture(jsonFixture))
        expect(comparableShape(fromText)).toEqual(comparableShape(fromJson))
      })
    }
  })

  describe("fuzz: resilient to reformatted whitespace/line-wrapping", () => {
    function mulberry32(seed: number) {
      return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    // Add a uniform base-indent offset (every line shifted by the same
    // amount, so relative depth between siblings is unaffected), plus
    // trailing whitespace per line and blank lines between lines — all of
    // which must not change the parsed shape.
    function reformat(text: string, rand: () => number): string {
      const basePad = " ".repeat(Math.floor(rand() * 4))
      return text
        .split("\n")
        .map((line) => basePad + line + (rand() < 0.3 ? "   " : ""))
        .join("\n\n")
    }

    for (const seed of [1, 2, 3]) {
      it(`seed ${seed}: reformatted whitespace still parses to the same shape`, () => {
        const rand = mulberry32(seed)
        const original = loadFixture("multi-way-join-text.txt")
        const reformatted = reformat(original, rand)
        const a = parsePostgresTextPlan(original)
        const b = parsePostgresTextPlan(reformatted)
        expect(comparableShape(b)).toEqual(comparableShape(a))
      })
    }
  })
})
