import { describe, expect, it } from "vitest"
import { badRowEstimate } from "../badRowEstimate"
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
})
