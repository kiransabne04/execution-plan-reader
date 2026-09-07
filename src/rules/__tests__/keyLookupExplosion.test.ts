import { describe, expect, it } from "vitest"
import { keyLookupExplosion } from "../keyLookupExplosion"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeLookup(overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "sqlserver", operatorType: "key_lookup", rawOperatorLabel: "Key Lookup", ...overrides })
}

function run(node: PlanNode) {
  return keyLookupExplosion(node, makeContext(node))
}

describe("keyLookupExplosion", () => {
  it("does NOT fire on a healthy lookup: 10 executions, 0.2ms total", () => {
    const node = makeLookup({ loops: 10, actualRows: 10, actualTimeMs: 0.2 })
    expect(run(node)).toEqual([])
  })

  it("fires on a pathological lookup: 300k+ executions with meaningful work", () => {
    const node = makeLookup({ loops: 350_000, actualRows: 350_000, actualTimeMs: 42_000, actualTimePerExecutionMs: 0.12 })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("key-lookup-explosion")
    expect(warnings[0].severity).toBe("critical")
    expect(warnings[0].shortText).toContain("350,000")
  })

  it("fires (without throwing) when runtime data is missing but loops/rows are present", () => {
    const node = makeLookup({ loops: 50_000, actualRows: 50_000, actualTimeMs: undefined, actualTimePerExecutionMs: undefined })
    expect(() => run(node)).not.toThrow()
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].longText).not.toContain("cumulative time")
  })

  it("does NOT fire on an estimate-only plan (no loops/actualRows/timing at all)", () => {
    const node = makeLookup({ estimatedRows: 50_000 })
    expect(() => run(node)).not.toThrow()
    expect(run(node)).toEqual([])
  })

  it("only fires on SQL Server key_lookup, never other engines/operators", () => {
    const wrongEngine = makeNode({ engine: "postgres", operatorType: "key_lookup", loops: 500_000, actualRows: 500_000 })
    expect(run(wrongEngine)).toEqual([])

    const wrongOperator = makeNode({ engine: "sqlserver", operatorType: "index_scan", loops: 500_000, actualRows: 500_000 })
    expect(run(wrongOperator)).toEqual([])
  })

  it("loop-count floor alone excludes a case with material reads but too few executions", () => {
    const node = makeLookup({ loops: 100, actualRows: 100, io: { bufferHits: 0, bufferReads: 50_000 } })
    expect(run(node)).toEqual([])
  })

  it("row/reads materiality floor excludes a high loop count with trivial work on each side", () => {
    // Loops clears its own floor, but neither actualRows nor reads clears
    // the materiality floor — two independent gates, not one.
    const node = makeLookup({ loops: 50_000, actualRows: 5, io: { bufferHits: 0, bufferReads: 5 } })
    expect(run(node)).toEqual([])
  })

  it("fires via the reads signal alone when actualRows isn't populated", () => {
    const node = makeLookup({ loops: 50_000, actualRows: undefined, io: { bufferHits: 20_000, bufferReads: 5_000 } })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("logical reads")
  })

  it("escalates to critical via cumulative time alone, even below the critical loop-count floor", () => {
    const node = makeLookup({ loops: 20_000, actualRows: 20_000, actualTimeMs: 6_000 })
    expect(run(node)[0].severity).toBe("critical")
  })

  it("stays warning below both critical thresholds", () => {
    const node = makeLookup({ loops: 20_000, actualRows: 20_000, actualTimeMs: 1_000 })
    expect(run(node)[0].severity).toBe("warning")
  })

  it("explains the seek, the repeated return to the clustered index, and never emits CREATE INDEX", () => {
    const node = makeLookup({ loops: 300_000, actualRows: 300_000, actualTimeMs: 30_000 })
    const longText = run(node)[0].longText
    expect(longText).toContain("index seek")
    expect(longText).toContain("go back to the clustered index")
    expect(longText).toContain("covering index")
    expect(longText).toContain("write overhead")
    // The text is allowed to NAME the policy ("never generates a CREATE
    // INDEX statement automatically") — what it must never do is emit an
    // actual DDL statement shape (a specific index name/columns/table).
    expect(longText).not.toMatch(/CREATE\s+INDEX\s+\w+\s+ON\s+/i)
  })

  it("labels the cumulative time figure as approximate, never a single measured duration", () => {
    const node = makeLookup({ loops: 300_000, actualRows: 300_000, actualTimeMs: 30_000, actualTimePerExecutionMs: 0.1 })
    const longText = run(node)[0].longText
    expect(longText).toContain("approximate total")
    expect(longText).toContain("average per lookup")
  })

  it("does not throw or misfire on pathological numeric input", () => {
    for (const loops of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeLookup({ loops, actualRows: 500_000 })
      expect(() => run(node)).not.toThrow()
      expect(run(node)).toEqual([])
    }
  })
})
