import { describe, expect, it } from "vitest"
import { LOOP_COUNT_THRESHOLD, highLoopCount } from "../highLoopCount"
import { makeContext, makeNode } from "./testHelpers"

describe("highLoopCount", () => {
  it("fires when high loop count meets meaningful per-loop cost", () => {
    const node = makeNode({ rawOperatorLabel: "Index Scan", loops: LOOP_COUNT_THRESHOLD * 2, actualTimeMs: 5 })
    const warnings = highLoopCount(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("high-loop-count")
  })

  it("does NOT fire on a cheap, high-loop-count operation (small per-loop cost is fine)", () => {
    // This is exactly our initplan-subplan-text fixture's shape: 950 loops
    // at 0.01ms each — the loop count alone must not be the trigger.
    const node = makeNode({ loops: 950, actualTimeMs: 0.01 })
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a low loop count even with high per-loop cost", () => {
    const node = makeNode({ loops: 2, actualTimeMs: 500 })
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })

  it("required suppression: does not fire on a cross-thread cumulated time figure", () => {
    const node = makeNode({
      engine: "sqlserver",
      loops: LOOP_COUNT_THRESHOLD * 2,
      actualTimeMs: 50,
      attributes: { "Actual Time Is Cumulated Across Threads": "true" },
    })
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })

  it("does not throw when loops/actualTimeMs are missing", () => {
    const node = makeNode({})
    expect(() => highLoopCount(node, makeContext(node))).not.toThrow()
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })

  it("does not propagate NaN/Infinity into warning text for pathological numeric input", () => {
    const node = makeNode({ loops: Number.POSITIVE_INFINITY, actualTimeMs: 5 })
    expect(() => highLoopCount(node, makeContext(node))).not.toThrow()
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })
})
