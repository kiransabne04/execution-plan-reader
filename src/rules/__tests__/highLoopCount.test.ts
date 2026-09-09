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

  // Confirmed bug (found via manual QA against a synthetic SQL Server
  // multi-execution Key Lookup): `actualTimeMs` is a raw CUMULATED TOTAL
  // for a SQL Server single-thread node with loops > 1 (ActualElapsedms is
  // summed across threads only, never divided by ActualExecutions — see
  // parseShowplanXml.ts) — NOT a per-loop average the way Postgres's own
  // Actual Total Time is. Using it directly as "per loop" and multiplying
  // by loops again compounded a loops² inflation. Fixed to prefer the
  // parser's own correctly-divided actualTimePerExecutionMs.
  it("uses actualTimePerExecutionMs, not raw actualTimeMs, as the per-loop figure when they differ (SQL Server)", () => {
    // A real total of 600ms across 1,200 single-thread executions:
    // actualTimeMs is the raw 600ms total; actualTimePerExecutionMs is the
    // parser's own correctly-divided 0.5ms average.
    const node = makeNode({
      engine: "sqlserver",
      loops: 1200,
      actualTimeMs: 600,
      actualTimePerExecutionMs: 0.5,
    })
    // 0.5ms per loop is below PER_LOOP_MS_THRESHOLD (1ms) — correctly
    // does NOT fire (the old, buggy code would have used 600ms "per loop"
    // and fired with a wildly inflated ~720,000ms total).
    expect(highLoopCount(node, makeContext(node))).toEqual([])
  })

  it("still fires and reports the correct, non-inflated total when actualTimePerExecutionMs itself clears both thresholds", () => {
    const node = makeNode({
      engine: "sqlserver",
      loops: 5000,
      actualTimeMs: 6000, // real cumulated total across all 5,000 executions
      actualTimePerExecutionMs: 1.2, // parser's own correctly-divided average
    })
    const warnings = highLoopCount(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("1.20ms each")
    // 5000 * 1.2 = 6000 — matches the real cumulated total, not a
    // loops-squared inflation.
    expect(warnings[0].shortText).toContain("6,000ms total")
  })

  it("falls back to actualTimeMs when actualTimePerExecutionMs is absent (Postgres — the two are always equal there)", () => {
    const node = makeNode({ loops: LOOP_COUNT_THRESHOLD * 2, actualTimeMs: 5 })
    const warnings = highLoopCount(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("5.00ms each")
  })
})
