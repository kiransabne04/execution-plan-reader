import { describe, expect, it } from "vitest"
import { badRowEstimate, computeMismatchFactor, severityForEstimateError } from "../badRowEstimate"
import { makeContext, makeNode } from "./testHelpers"

describe("badRowEstimate", () => {
  it("fires when actual rows vastly exceed the estimate", () => {
    const node = makeNode({ estimatedRows: 100, actualRows: 50_000 })
    const warnings = badRowEstimate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("bad-row-estimate")
    expect(warnings[0].shortText).toContain("500x")
  })

  it("fires when actual rows are vastly under the estimate", () => {
    const node = makeNode({ estimatedRows: 100_000, actualRows: 10 })
    expect(badRowEstimate(node, makeContext(node))).toHaveLength(1)
  })

  it("does NOT fire when estimate and actual are close", () => {
    const node = makeNode({ estimatedRows: 1000, actualRows: 1100 })
    expect(badRowEstimate(node, makeContext(node))).toEqual([])
  })

  it("required suppression: never fires on BitmapAnd, even with actual rows = 0", () => {
    const node = makeNode({ operatorType: "bitmap_and", rawOperatorLabel: "BitmapAnd", estimatedRows: 40, actualRows: 0 })
    expect(badRowEstimate(node, makeContext(node))).toEqual([])
  })

  it("required suppression: never fires on BitmapOr, even with actual rows = 0", () => {
    const node = makeNode({ operatorType: "bitmap_or", rawOperatorLabel: "BitmapOr", estimatedRows: 40, actualRows: 0 })
    expect(badRowEstimate(node, makeContext(node))).toEqual([])
  })

  it("handles actualRows = 0 on a non-suppressed node as an infinite-ratio mismatch, without NaN/Infinity leaking into text", () => {
    const node = makeNode({ operatorType: "index_scan", estimatedRows: 500, actualRows: 0 })
    const warnings = badRowEstimate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).not.toMatch(/NaN|Infinity/)
    expect(warnings[0].longText).not.toMatch(/NaN|Infinity/)
  })

  it("treats missing data as insufficient rather than guessing", () => {
    const node = makeNode({ estimatedRows: undefined, actualRows: 500 })
    expect(badRowEstimate(node, makeContext(node))).toEqual([])
  })

  it("does not throw on zero/negative/NaN-adjacent numeric edge cases", () => {
    for (const estimatedRows of [0, -5, Number.NaN]) {
      const node = makeNode({ estimatedRows, actualRows: 100 })
      expect(() => badRowEstimate(node, makeContext(node))).not.toThrow()
      expect(badRowEstimate(node, makeContext(node))).toEqual([])
    }
    const negativeActual = makeNode({ estimatedRows: 100, actualRows: -5 })
    expect(() => badRowEstimate(negativeActual, makeContext(negativeActual))).not.toThrow()
    expect(badRowEstimate(negativeActual, makeContext(negativeActual))).toEqual([])
  })

  // Story 25.5 — never states "stale statistics" as a settled fact.
  it("recommends investigating possible causes rather than diagnosing stale statistics", () => {
    const node = makeNode({ estimatedRows: 100, actualRows: 50_000 })
    const warnings = badRowEstimate(node, makeContext(node))
    expect(warnings[0].longText).not.toMatch(/stale/i)
    expect(warnings[0].longText).toContain("statistics freshness")
    expect(warnings[0].longText).toContain("extended statistics")
    expect(warnings[0].longText).toContain("parameter values")
  })
})

// Story 25.4 — materiality-graded severity: ratio alone no longer decides
// severity. Both worked examples from the story are covered end-to-end
// through the real rule, not just the pure helper below.
describe("badRowEstimate — Story 25.4 materiality-graded severity", () => {
  it("est 1 → actual 50 (50x ratio, 49 rows difference): still fires, but capped at info — not material", () => {
    const node = makeNode({ estimatedRows: 1, actualRows: 50 })
    const warnings = badRowEstimate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe("info")
  })

  it("est 10 → actual 500,000 (50,000x ratio, ~500k rows difference): material, at least warning", () => {
    const node = makeNode({ estimatedRows: 10, actualRows: 500_000 })
    const warnings = badRowEstimate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).not.toBe("info")
  })
})

describe("severityForEstimateError", () => {
  const baseContext = { hasActualData: false, totalActualTimeMs: undefined }

  it("caps at info when absolute row difference is below the materiality floor, regardless of ratio", () => {
    const severity = severityForEstimateError({ operatorType: "seq_scan", actualTimeMs: undefined }, 1, 50, 50, baseContext)
    expect(severity).toBe("info")
  })

  it("defaults to warning above the floor with no escalation signals", () => {
    const severity = severityForEstimateError({ operatorType: "seq_scan", actualTimeMs: undefined }, 100, 60_000, 600, baseContext)
    expect(severity).toBe("warning")
  })

  it("escalates to critical with two signals: a very large ratio + feeding a join", () => {
    const severity = severityForEstimateError({ operatorType: "hash_join", actualTimeMs: undefined }, 10, 500_000, 50_000, baseContext)
    expect(severity).toBe("critical")
  })

  it("escalates to critical with two signals: a very large ratio + a meaningful runtime share", () => {
    const context = { hasActualData: true, totalActualTimeMs: 1000 }
    const severity = severityForEstimateError({ operatorType: "seq_scan", actualTimeMs: 200 }, 10, 500_000, 50_000, context)
    expect(severity).toBe("critical")
  })

  it("stays warning with only ONE escalation signal (large ratio alone)", () => {
    const severity = severityForEstimateError({ operatorType: "seq_scan", actualTimeMs: undefined }, 10, 500_000, 50_000, baseContext)
    expect(severity).toBe("warning")
  })

  it("treats the near-infinite-ratio case (factor undefined) as a very-large-ratio signal", () => {
    const severity = severityForEstimateError({ operatorType: "hash_join", actualTimeMs: undefined }, 500, 0, undefined, baseContext)
    expect(severity).toBe("critical")
  })

  it("does not treat a small runtime share as meaningful", () => {
    const context = { hasActualData: true, totalActualTimeMs: 1000 }
    const severity = severityForEstimateError({ operatorType: "seq_scan", actualTimeMs: 5 }, 10, 500_000, 50_000, context)
    expect(severity).toBe("warning") // only the large-ratio signal fires; runtime share (0.5%) doesn't
  })
})

// Design mockup review (post-Episode-18): spec §3's badge table names
// "mismatch factor" explicitly, rendered in the mockup as "est. mismatch
// 95×" — this rule's own ratio math, extracted into a reusable function so
// the node-card badge (buildGraphElements.test.ts) reads the SAME number
// this rule's prose already reports, not a second independently-computed
// ratio.
describe("computeMismatchFactor", () => {
  it("returns isBad + a rounded whole-number factor for a genuine mismatch", () => {
    const result = computeMismatchFactor(100, 50_000)
    expect(result).toEqual({ isBad: true, factor: 500, direction: "more" })
  })

  it("reports direction: 'fewer' when actual undershoots the estimate", () => {
    const result = computeMismatchFactor(100_000, 10)
    expect(result?.isBad).toBe(true)
    expect(result?.direction).toBe("fewer")
    expect(result?.factor).toBe(10_000)
  })

  it("isBad is false for a close estimate, but still returns a (small) factor", () => {
    const result = computeMismatchFactor(1000, 1100)
    expect(result?.isBad).toBe(false)
  })

  it("factor is undefined for the near-infinite-ratio case (actualRows === 0) — badRowEstimate's own 'far' fallback", () => {
    const result = computeMismatchFactor(500, 0)
    expect(result?.isBad).toBe(true)
    expect(result?.factor).toBeUndefined()
  })

  it("returns undefined entirely for missing/degenerate data, same guard badRowEstimate itself uses", () => {
    expect(computeMismatchFactor(undefined, 500)).toBeUndefined()
    expect(computeMismatchFactor(100, undefined)).toBeUndefined()
    expect(computeMismatchFactor(0, 100)).toBeUndefined()
    expect(computeMismatchFactor(100, -5)).toBeUndefined()
    expect(computeMismatchFactor(Number.NaN, 100)).toBeUndefined()
  })

  it("the rule's own shortText factor and this function's factor agree exactly (same underlying number)", () => {
    const node = makeNode({ estimatedRows: 12_400, actualRows: 1_182_904 })
    const warnings = badRowEstimate(node, makeContext(node))
    const result = computeMismatchFactor(12_400, 1_182_904)
    expect(warnings[0].shortText).toContain(`${result?.factor}x`)
  })
})
