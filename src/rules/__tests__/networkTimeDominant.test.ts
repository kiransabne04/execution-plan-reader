import { describe, expect, it } from "vitest"
import { networkTimeDominant } from "../networkTimeDominant"
import { makeContext, makeNode } from "./testHelpers"
import type { PlanNode } from "../../parsers/normalize"

function makeNetworkNode(networkCommunicationPercentage: number, overallPercentage: number, overrides: Partial<PlanNode> = {}) {
  return makeNode({
    engine: "snowflake",
    rawOperatorLabel: "Exchange",
    timeBreakdown: { networkCommunicationPercentage, overallPercentage },
    ...overrides,
  })
}

function run(node: PlanNode) {
  return networkTimeDominant(node, makeContext(node))
}

describe("networkTimeDominant", () => {
  it("does NOT fire on a high relative percentage with a trivial absolute (overall) share", () => {
    // 90% of this node's own time is network, but this node is only 0.01%
    // of the whole query — the exact case the dual-gate excludes.
    expect(run(makeNetworkNode(90, 0.01))).toEqual([])
  })

  it("does NOT fire on a material overall share with a low relative network percentage", () => {
    expect(run(makeNetworkNode(10, 50))).toEqual([])
  })

  it("fires when both relative percentage and absolute (overall) share are material", () => {
    const warnings = run(makeNetworkNode(40, 20))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("network-time-dominant")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical above the high-network threshold", () => {
    expect(run(makeNetworkNode(70, 20))[0].severity).toBe("critical")
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", timeBreakdown: { networkCommunicationPercentage: 90, overallPercentage: 50 } })
    expect(run(node)).toEqual([])
  })

  it("lists possible causes as a list, not a single diagnosis", () => {
    const longText = run(makeNetworkNode(40, 20))[0].longText
    expect(longText).toContain("Possible causes include")
    expect(longText).toContain("not a diagnosis of which one applies")
  })

  it("does not throw when timeBreakdown is entirely absent", () => {
    const node = makeNode({ engine: "snowflake" })
    expect(() => run(node)).not.toThrow()
    expect(run(node)).toEqual([])
  })
})
