import { describe, expect, it } from "vitest"
import { sqlServerExchange } from "../sqlServerExchange"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeExchange(overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "sqlserver", operatorType: "exchange", rawOperatorLabel: "Parallelism", attributes: { LogicalOp: "Repartition Streams" }, ...overrides })
}

function run(node: PlanNode) {
  return sqlServerExchange(node, makeContext(node))
}

describe("sqlServerExchange", () => {
  it("does NOT fire below the row-volume floor", () => {
    const node = makeExchange({ actualRows: 500, actualTimeMs: 5_000 })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire below the runtime floor even with huge row volume", () => {
    const node = makeExchange({ actualRows: 1_000_000, actualTimeMs: 10 })
    expect(run(node)).toEqual([])
  })

  it("fires when both row volume and runtime are material", () => {
    const node = makeExchange({ actualRows: 500_000, actualTimeMs: 1_980 })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("exchange-data-movement")
    expect(warnings[0].shortText).toContain("Repartition Streams")
  })

  it("describes Distribute Streams and Gather Streams distinctly from Repartition Streams", () => {
    const distribute = makeExchange({ attributes: { LogicalOp: "Distribute Streams" }, actualRows: 500_000, actualTimeMs: 1_000 })
    expect(run(distribute)[0].longText).toContain("splitting a single serial stream")

    const gather = makeExchange({ operatorType: "gather", attributes: { LogicalOp: "Gather Streams" }, actualRows: 500_000, actualTimeMs: 1_000 })
    expect(run(gather)[0].longText).toContain("collecting multiple parallel threads")
  })

  it("labels a thread-cumulated time figure as such, not a single thread's wall-clock time", () => {
    const node = makeExchange({
      actualRows: 500_000,
      actualTimeMs: 2_000,
      attributes: { LogicalOp: "Repartition Streams", "Actual Time Is Cumulated Across Threads": "true" },
    })
    const longText = run(node)[0].longText
    expect(longText).toContain("summed across threads")
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const node = makeNode({ engine: "postgres", operatorType: "exchange", actualRows: 500_000, actualTimeMs: 2_000 })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire on an unrelated operator type", () => {
    const node = makeExchange({ operatorType: "index_scan", actualRows: 500_000, actualTimeMs: 2_000 })
    expect(run(node)).toEqual([])
  })

  it("does not throw on pathological numeric input", () => {
    for (const actualRows of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeExchange({ actualRows, actualTimeMs: 2_000 })
      expect(() => run(node)).not.toThrow()
    }
  })
})
