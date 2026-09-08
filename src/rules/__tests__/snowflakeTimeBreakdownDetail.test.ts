import { describe, expect, it } from "vitest"
import { dominantTimeCategory, isOverallMaterial } from "../snowflakeTimeBreakdownDetail"

describe("dominantTimeCategory", () => {
  it("returns the category with the highest percentage", () => {
    expect(dominantTimeCategory({ processingPercentage: 10, remoteDiskIoPercentage: 70, networkCommunicationPercentage: 20 })).toEqual({
      category: "remote disk",
      percentage: 70,
    })
  })

  it("returns undefined when timeBreakdown itself is undefined", () => {
    expect(dominantTimeCategory(undefined)).toBeUndefined()
  })

  it("returns undefined when no category has any data", () => {
    expect(dominantTimeCategory({})).toBeUndefined()
  })

  it("breaks a tie deterministically via listed field order (processing first)", () => {
    expect(dominantTimeCategory({ processingPercentage: 50, networkCommunicationPercentage: 50 })).toEqual({ category: "processing", percentage: 50 })
  })

  it("ignores non-finite values", () => {
    expect(dominantTimeCategory({ processingPercentage: Number.NaN, networkCommunicationPercentage: 40 })).toEqual({ category: "network", percentage: 40 })
  })
})

describe("isOverallMaterial", () => {
  it("is true at or above the material threshold", () => {
    expect(isOverallMaterial({ overallPercentage: 5 })).toBe(true)
    expect(isOverallMaterial({ overallPercentage: 50 })).toBe(true)
  })

  it("is false below the threshold", () => {
    expect(isOverallMaterial({ overallPercentage: 0.01 })).toBe(false)
  })

  it("is false when overallPercentage or timeBreakdown itself is absent", () => {
    expect(isOverallMaterial({})).toBe(false)
    expect(isOverallMaterial(undefined)).toBe(false)
  })
})
