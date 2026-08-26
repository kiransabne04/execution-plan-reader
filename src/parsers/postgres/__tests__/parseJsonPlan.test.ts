import { describe, expect, it } from "vitest"
import { parsePostgresJsonPlan } from "../parseJsonPlan"
import { PlanParseError, collectNodes, type PlanNode } from "../../normalize"
import { loadFixture } from "./testUtils"

function countNodes(node: PlanNode): number {
  return collectNodes(node).length
}

const collect = collectNodes

describe("parsePostgresJsonPlan", () => {
  it("parses a single-node plan and maps all standard fields", () => {
    const root = parsePostgresJsonPlan(loadFixture("simple-seq-scan.json"))
    expect(root.engine).toBe("postgres")
    expect(root.rawOperatorLabel).toBe("Seq Scan")
    expect(root.operatorType).toBe("seq_scan")
    expect(root.estimatedRows).toBe(1200)
    expect(root.estimatedCost).toBe(22.0)
    expect(root.actualTimeMs).toBe(0.045)
    expect(root.actualRows).toBe(1180)
    expect(root.loops).toBe(1)
    expect(root.role).toBe("main")
    expect(root.children).toEqual([])
    expect(root.warnings).toEqual([])
    // Top-level fields alongside "Plan" are preserved, not dropped.
    expect(root.attributes["Planning Time"]).toBe(0.123)
    expect(root.attributes["Execution Time"]).toBe(0.089)
    // Non-promoted per-node fields survive untouched in the attributes bag.
    expect(root.attributes["Relation Name"]).toBe("users")
  })

  it("reconstructs a nested Plans tree of matching depth and order", () => {
    const root = parsePostgresJsonPlan(loadFixture("multi-way-join.json"))
    expect(root.rawOperatorLabel).toBe("Hash Join")
    expect(root.children).toHaveLength(2)
    expect(root.children[0].rawOperatorLabel).toBe("Seq Scan")
    expect(root.children[0].attributes["Relation Name"]).toBe("orders")
    expect(root.children[1].rawOperatorLabel).toBe("Hash")
    expect(root.children[1].children).toHaveLength(1)
    expect(root.children[1].children[0].attributes["Relation Name"]).toBe("customers")
    expect(countNodes(root)).toBe(4)
  })

  it("does not crash on missing ANALYZE fields and leaves actual* undefined", () => {
    const root = parsePostgresJsonPlan(loadFixture("estimate-only-plan.json"))
    for (const node of collect(root)) {
      expect(node.actualTimeMs).toBeUndefined()
      expect(node.actualRows).toBeUndefined()
      expect(node.loops).toBeUndefined()
      // Estimates are still present.
      expect(node.estimatedRows).toBeDefined()
      expect(node.estimatedCost).toBeDefined()
    }
  })

  it("renders a trivial single-node (empty) plan without crashing", () => {
    const root = parsePostgresJsonPlan(loadFixture("empty-plan.json"))
    expect(root.rawOperatorLabel).toBe("Result")
    expect(root.children).toEqual([])
  })

  it("preserves BitmapAnd/BitmapOr actual rows = 0 as a real 0, not undefined", () => {
    const root = parsePostgresJsonPlan(loadFixture("bitmap-and-or-zero-rows.json"))
    const bitmapAnd = collect(root).find((n) => n.rawOperatorLabel === "BitmapAnd")
    expect(bitmapAnd).toBeDefined()
    expect(bitmapAnd!.operatorType).toBe("bitmap_and")
    expect(bitmapAnd!.actualRows).toBe(0)
  })

  it("does not lose data from a duplicate JSON key (two Workers blocks)", () => {
    const root = parsePostgresJsonPlan(loadFixture("duplicate-workers-key.json"))
    expect(root.rawOperatorLabel).toBe("Gather")
    // Merged/serialized, but both worker blocks must be present somewhere in it.
    const workers = String(root.attributes["Workers"])
    expect(workers).toContain('"Worker Number":0')
    expect(workers).toContain('"Worker Number":1')
  })

  it("preserves per-worker parallel data distinctly rather than only a summed figure", () => {
    const root = parsePostgresJsonPlan(loadFixture("parallel-workers-cumulated.json"))
    expect(root.attributes["Workers Launched"]).toBe(3)
    const workers = String(root.attributes["Workers"])
    const parsedWorkers = JSON.parse(workers) as unknown[]
    expect(parsedWorkers).toHaveLength(3)
  })

  it("represents each CTE Scan reference distinctly, tagged with the shared CTE name", () => {
    const root = parsePostgresJsonPlan(loadFixture("cte-referenced-multiple-times.json"))
    const cteScans = collect(root).filter((n) => n.rawOperatorLabel === "CTE Scan")
    expect(cteScans).toHaveLength(2)
    expect(cteScans[0].attributes["CTE Name"]).toBe("active_users")
    expect(cteScans[1].attributes["CTE Name"]).toBe("active_users")
    // Materializing subtree exists exactly once — not duplicated into each scan site.
    const initPlanNode = collect(root).find((n) => n.role === "init")
    expect(initPlanNode).toBeDefined()
    expect(initPlanNode!.attributes["Subplan Name"]).toBe("CTE active_users")
  })

  it("tags InitPlan/SubPlan nodes with a distinct role, off the main execution path", () => {
    const root = parsePostgresJsonPlan(loadFixture("initplan-subplan.json"))
    const all = collect(root)
    expect(root.role).toBe("main")
    const init = all.find((n) => n.attributes["Subplan Name"] === "InitPlan 1 (returns $0)")
    const sub = all.find((n) => n.attributes["Subplan Name"] === "SubPlan 2")
    expect(init?.role).toBe("init")
    expect(sub?.role).toBe("sub")
  })

  it("falls back to 'unknown' operatorType for an unmapped Node Type, without throwing", () => {
    const raw = JSON.stringify([
      { Plan: { "Node Type": "SomeBrandNewNodeType", "Total Cost": 1, "Plan Rows": 1 } },
    ])
    const root = parsePostgresJsonPlan(raw)
    expect(root.operatorType).toBe("unknown")
    expect(root.rawOperatorLabel).toBe("SomeBrandNewNodeType")
  })

  it("throws EMPTY_INPUT on empty/whitespace-only input", () => {
    expect(() => parsePostgresJsonPlan("   \n  ")).toThrow(PlanParseError)
    try {
      parsePostgresJsonPlan("")
    } catch (err) {
      expect((err as PlanParseError).code).toBe("EMPTY_INPUT")
    }
  })

  it("throws a specific TRUNCATED_INPUT error for a cut-off paste, without echoing raw content", () => {
    try {
      parsePostgresJsonPlan(loadFixture("truncated-plan.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("TRUNCATED_INPUT")
      expect(e.message).not.toContain("users")
      expect(e.message).not.toContain("Seq Scan")
    }
  })

  it("throws a friendly NOT_A_PLAN error for pasted non-plan text (e.g. the SQL query itself)", () => {
    try {
      parsePostgresJsonPlan(loadFixture("non-plan-text.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("NOT_A_PLAN")
      expect(e.message).not.toContain("SELECT")
    }
  })

  it("throws NOT_A_PLAN for well-formed JSON that isn't a plan shape", () => {
    try {
      parsePostgresJsonPlan('{"foo": "bar"}')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("NOT_A_PLAN")
    }
  })

  it("accepts a bare Plan object without the top-level array/wrapper", () => {
    const raw = JSON.stringify({
      Plan: { "Node Type": "Result", "Total Cost": 0.01, "Plan Rows": 1 },
    })
    const root = parsePostgresJsonPlan(raw)
    expect(root.rawOperatorLabel).toBe("Result")
  })

  describe("property-based: deep/wide plans parse without throwing and preserve node count", () => {
    // Deterministic pseudo-random generator so failures reproduce.
    function mulberry32(seed: number) {
      return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    function generatePlan(rand: () => number, depth: number, breadthCap: number) {
      let count = 1
      function build(remainingDepth: number): Record<string, unknown> {
        const breadth = remainingDepth <= 0 ? 0 : Math.floor(rand() * breadthCap)
        const children: Record<string, unknown>[] = []
        for (let i = 0; i < breadth; i++) {
          count++
          children.push(build(remainingDepth - 1))
        }
        const node: Record<string, unknown> = {
          "Node Type": "Seq Scan",
          "Total Cost": rand() * 1000,
          "Plan Rows": Math.floor(rand() * 1000),
          "Actual Total Time": rand() * 100,
          "Actual Rows": Math.floor(rand() * 1000),
          "Actual Loops": 1,
        }
        if (children.length > 0) node["Plans"] = children
        return node
      }
      const plan = build(depth)
      return { plan, count }
    }

    for (const seed of [1, 2, 3, 4, 5]) {
      it(`seed ${seed}: random nested plan parses cleanly and preserves node count`, () => {
        const rand = mulberry32(seed)
        const { plan, count } = generatePlan(rand, 6, 4)
        const raw = JSON.stringify([{ Plan: plan }])
        const root = parsePostgresJsonPlan(raw)
        expect(countNodes(root)).toBe(count)
      })
    }

    it("handles a very deep/wide plan (100+ nodes) without throwing", () => {
      const rand = mulberry32(42)
      const { plan, count } = generatePlan(rand, 8, 6)
      expect(count).toBeGreaterThan(100)
      const raw = JSON.stringify([{ Plan: plan }])
      const root = parsePostgresJsonPlan(raw)
      expect(countNodes(root)).toBe(count)
    })
  })
})
