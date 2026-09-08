import { describe, expect, it } from "vitest"
import { remoteSpill } from "../remoteSpill"
import { makeContext, makeNode } from "./testHelpers"
import type { PlanNode } from "../../parsers/normalize"

const MB = 1024 * 1024

function makeSpillNode(bytesRemote: number, overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "snowflake", rawOperatorLabel: "Aggregate", spill: { occurred: true, bytesRemote }, ...overrides })
}

function run(node: PlanNode) {
  return remoteSpill(node, makeContext(node))
}

describe("remoteSpill", () => {
  it("does NOT fire below the warning floor", () => {
    expect(run(makeSpillNode(1 * MB))).toEqual([])
  })

  it("fires warning between the floors", () => {
    const warnings = run(makeSpillNode(20 * MB))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("remote-spill")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical at the critical floor", () => {
    expect(run(makeSpillNode(150 * MB))[0].severity).toBe("critical")
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", spill: { occurred: true, bytesRemote: 150 * MB } })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire when spill.occurred is false/absent", () => {
    const node = makeNode({ engine: "snowflake", spill: undefined })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire when bytesRemote is absent (a local-only spill)", () => {
    const node = makeNode({ engine: "snowflake", spill: { occurred: true, bytesLocal: 500 * MB } })
    expect(run(node)).toEqual([])
  })

  it("explains remote spill is more expensive than local/memory", () => {
    const longText = run(makeSpillNode(150 * MB))[0].longText
    expect(longText).toContain("significantly more expensive")
  })

  it("never directly prescribes a warehouse resize as THE fix", () => {
    const longText = run(makeSpillNode(150 * MB))[0].longText
    expect(longText).toContain("one possible angle, but not automatically the right one")
  })

  it("fires at a lower byte count than an equivalent local spill would need — the comparative severity requirement", () => {
    // 100MB clears remote's critical floor but only local's warning floor.
    expect(run(makeSpillNode(100 * MB))[0].severity).toBe("critical")
  })

  it("does not throw on pathological numeric input", () => {
    for (const bytesRemote of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() => run(makeSpillNode(bytesRemote))).not.toThrow()
    }
  })
})
