import { describe, expect, it } from "vitest"
import { sqlServerSortSpill } from "../sqlServerSortSpill"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeSpillingSort(overrides: Partial<PlanNode> = {}) {
  return makeNode({
    engine: "sqlserver",
    operatorType: "sort",
    rawOperatorLabel: "Sort",
    spill: { occurred: true, detail: "spill level 1" },
    attributes: { "Spill Level": 1 },
    ...overrides,
  })
}

describe("sqlServerSortSpill", () => {
  it("does NOT fire when no spill occurred", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "sort", spill: undefined })
    expect(sqlServerSortSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine, even with spill.occurred true", () => {
    const node = makeNode({ engine: "postgres", operatorType: "sort", spill: { occurred: true } })
    expect(sqlServerSortSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on an operator other than sort (e.g. a spilling Hash Match)", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "hash_join",
      rawOperatorLabel: "Hash Match",
      spill: { occurred: true },
      attributes: { "Spill Level": 1 },
    })
    expect(sqlServerSortSpill(node, makeContext(node))).toEqual([])
  })

  it("fires warning at spill level 1 (single-pass spill)", () => {
    const node = makeSpillingSort({ attributes: { "Spill Level": 1 } })
    const warnings = sqlServerSortSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("sqlserver-sort-spill")
    expect(warnings[0].severity).toBe("warning")
    expect(warnings[0].shortText).toContain("level 1")
  })

  it("escalates to critical at spill level 2+", () => {
    const node = makeSpillingSort({ attributes: { "Spill Level": 2 } })
    expect(sqlServerSortSpill(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("explains level 1 as the baseline case, and level 2+ as more severe without claiming a specific unconfirmed mechanism", () => {
    const level1 = makeSpillingSort({ attributes: { "Spill Level": 1 } })
    expect(sqlServerSortSpill(level1, makeContext(level1))[0].longText).toContain("baseline spill case")

    const level2 = makeSpillingSort({ attributes: { "Spill Level": 2 } })
    const level2Text = sqlServerSortSpill(level2, makeContext(level2))[0].longText
    expect(level2Text).toContain("more severe spill scenario")
    expect(level2Text).not.toMatch(/recursive|spilled data itself had to be spilled again/i)
  })

  it("still fires (warning) when spill level itself is missing from attributes", () => {
    const node = makeSpillingSort({ attributes: {} })
    const warnings = sqlServerSortSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe("warning")
    expect(warnings[0].shortText).toContain("unspecified level")
  })

  it("exposes the operator's own reads, attributed honestly to the spill (not claimed as an exact tempdb count)", () => {
    const node = makeSpillingSort({ io: { bufferHits: 100, bufferReads: 5_000 } })
    const longText = sqlServerSortSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("5,100")
    expect(longText).toContain("largely attributable to the tempdb spill")
  })

  it("omits the reads note entirely when no I/O data is present", () => {
    const node = makeSpillingSort({ io: undefined })
    const longText = sqlServerSortSpill(node, makeContext(node))[0].longText
    expect(longText).not.toContain("own reads totaled")
  })

  it("explicitly states that tempdb writes and page counts are not available from the plan", () => {
    const node = makeSpillingSort()
    const longText = sqlServerSortSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("doesn't report separate tempdb write counts or page counts")
  })

  it("exposes the affected operator and this node's own runtime, with a share of total when available", () => {
    const node = makeSpillingSort({ actualTimeMs: 4_000 })
    const root = makeNode({ actualTimeMs: 8_000, children: [node] })
    const context = makeContext(root, { hasActualData: true, totalActualTimeMs: 8_000 })
    const warnings = sqlServerSortSpill(node, context)
    expect(warnings[0].shortText).toContain("This Sort took 4000ms")
    expect(warnings[0].shortText).toContain("50.0%")
  })

  it("omits the runtime-share percentage (but still shows raw time) on an estimate-only-adjacent context with no total", () => {
    const node = makeSpillingSort({ actualTimeMs: 4_000 })
    const context = makeContext(node, { hasActualData: false, totalActualTimeMs: undefined })
    const longText = sqlServerSortSpill(node, context)[0].longText
    expect(longText).toContain("This Sort took 4000ms.")
    expect(longText).not.toContain("%")
  })

  it("does not throw or misfire on pathological numeric input", () => {
    for (const spillLevel of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const node = makeSpillingSort({ attributes: { "Spill Level": spillLevel } })
      expect(() => sqlServerSortSpill(node, makeContext(node))).not.toThrow()
    }
  })
})
