import { describe, expect, it } from "vitest"
import { computeCumulativeLoopWork } from "../loopWork"

describe("computeCumulativeLoopWork", () => {
  it("multiplies loops by per-loop time", () => {
    expect(computeCumulativeLoopWork(500, 2)).toBe(1000)
  })

  it("keeps fractional precision — rounding is display-layer, not this function's job", () => {
    expect(computeCumulativeLoopWork(10_001, 0.1)).toBeCloseTo(1000.1, 5)
  })

  it("returns undefined when loops is missing", () => {
    expect(computeCumulativeLoopWork(undefined, 2)).toBeUndefined()
  })

  it("returns undefined when per-loop time is missing", () => {
    expect(computeCumulativeLoopWork(500, undefined)).toBeUndefined()
  })

  it("returns undefined when both are missing (the estimate-only-plan case)", () => {
    expect(computeCumulativeLoopWork(undefined, undefined)).toBeUndefined()
  })

  it("returns undefined for a NaN loops value, never propagating NaN", () => {
    expect(computeCumulativeLoopWork(Number.NaN, 2)).toBeUndefined()
  })

  it("returns undefined for a NaN per-loop-time value, never propagating NaN", () => {
    expect(computeCumulativeLoopWork(500, Number.NaN)).toBeUndefined()
  })

  it("returns undefined when loops is Infinity, never surfacing Infinity", () => {
    expect(computeCumulativeLoopWork(Number.POSITIVE_INFINITY, 2)).toBeUndefined()
  })

  it("returns undefined when the product itself overflows to Infinity", () => {
    expect(computeCumulativeLoopWork(Number.MAX_VALUE, Number.MAX_VALUE)).toBeUndefined()
  })

  it("treats zero loops or zero per-loop time as a valid, finite zero result", () => {
    expect(computeCumulativeLoopWork(0, 5)).toBe(0)
    expect(computeCumulativeLoopWork(5, 0)).toBe(0)
  })
})
