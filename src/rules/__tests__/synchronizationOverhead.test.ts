import { describe, expect, it } from "vitest"
import { synchronizationOverhead } from "../synchronizationOverhead"
import { makeContext, makeNode } from "./testHelpers"
import type { PlanNode } from "../../parsers/normalize"

function makeSyncNode(synchronizationPercentage: number, overallPercentage: number, overrides: Partial<PlanNode> = {}) {
  return makeNode({
    engine: "snowflake",
    rawOperatorLabel: "Aggregate",
    timeBreakdown: { synchronizationPercentage, overallPercentage },
    ...overrides,
  })
}

function run(node: PlanNode) {
  return synchronizationOverhead(node, makeContext(node))
}

describe("synchronizationOverhead", () => {
  it("does NOT fire on a high relative percentage with a trivial absolute (overall) share", () => {
    expect(run(makeSyncNode(90, 0.01))).toEqual([])
  })

  it("does NOT fire on a material overall share with a low relative sync percentage", () => {
    expect(run(makeSyncNode(5, 50))).toEqual([])
  })

  it("fires when both relative percentage and absolute (overall) share are material", () => {
    const warnings = run(makeSyncNode(25, 20))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("synchronization-overhead")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical above the high-sync threshold", () => {
    expect(run(makeSyncNode(60, 20))[0].severity).toBe("critical")
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", timeBreakdown: { synchronizationPercentage: 90, overallPercentage: 50 } })
    expect(run(node)).toEqual([])
  })

  it("explains synchronization as waiting on other parallel work, not compute", () => {
    const longText = run(makeSyncNode(25, 20))[0].longText
    expect(longText).toContain("waiting on other parallel workers")
  })

  it("does not throw when timeBreakdown is entirely absent", () => {
    const node = makeNode({ engine: "snowflake" })
    expect(() => run(node)).not.toThrow()
    expect(run(node)).toEqual([])
  })
})
