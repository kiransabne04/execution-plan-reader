import { describe, expect, it } from "vitest"
import { dominantTimeComponent } from "../dominantTimeComponent"
import { makeContext, makeNode } from "./testHelpers"
import type { PlanNode } from "../../parsers/normalize"

function run(node: PlanNode) {
  return dominantTimeComponent(node, makeContext(node))
}

describe("dominantTimeComponent", () => {
  it("does NOT fire when processing dominates (the healthy, expected default)", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: { processingPercentage: 90, overallPercentage: 40 } })
    expect(run(node)).toEqual([])
  })

  it("fires info when remote disk dominates, matching the story's own example phrasing", () => {
    const node = makeNode({ engine: "snowflake", rawOperatorLabel: "TableScan", timeBreakdown: { remoteDiskIoPercentage: 70, processingPercentage: 10, overallPercentage: 30 } })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("dominant-time-component")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].shortText).toContain("remote I/O")
  })

  it("fires for each non-processing dominant category with its own phrasing", () => {
    const cases: [Partial<PlanNode["timeBreakdown"]>, string][] = [
      [{ localDiskIoPercentage: 60 }, "local I/O"],
      [{ networkCommunicationPercentage: 60 }, "network communication"],
      [{ synchronizationPercentage: 60 }, "synchronization"],
    ]
    for (const [breakdown, expectedPhrase] of cases) {
      const node = makeNode({ engine: "snowflake", timeBreakdown: { ...breakdown, overallPercentage: 30 } })
      expect(run(node)[0].shortText).toContain(expectedPhrase)
    }
  })

  it("does NOT fire when the node's own overall share of the query is trivial", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: { remoteDiskIoPercentage: 90, overallPercentage: 0.01 } })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", timeBreakdown: { remoteDiskIoPercentage: 90, overallPercentage: 30 } })
    expect(run(node)).toEqual([])
  })

  it("does not throw when timeBreakdown is entirely absent", () => {
    const node = makeNode({ engine: "snowflake" })
    expect(() => run(node)).not.toThrow()
    expect(run(node)).toEqual([])
  })

  it("never claims this is a defect on its own", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: { remoteDiskIoPercentage: 70, overallPercentage: 30 } })
    const longText = run(node)[0].longText
    expect(longText).toContain("without claiming this is necessarily a problem")
  })
})
