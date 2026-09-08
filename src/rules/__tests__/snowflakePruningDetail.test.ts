import { describe, expect, it } from "vitest"
import { computePruningRatio, isPruningPoor } from "../snowflakePruningDetail"
import { makeNode } from "./testHelpers"

describe("computePruningRatio", () => {
  it("computes the scanned/total ratio", () => {
    const node = makeNode({ pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 } })
    expect(computePruningRatio(node)).toEqual({ partitionsScanned: 9_800, partitionsTotal: 10_000, ratio: 0.98 })
  })

  it("returns undefined when the table's total partition count is too small to judge (tiny table)", () => {
    const node = makeNode({ pruning: { partitionsScanned: 3, partitionsTotal: 5 } })
    expect(computePruningRatio(node)).toBeUndefined()
  })

  it("returns undefined when either figure is missing", () => {
    expect(computePruningRatio(makeNode({ pruning: { partitionsScanned: 100 } }))).toBeUndefined()
    expect(computePruningRatio(makeNode({ pruning: { partitionsTotal: 10_000 } }))).toBeUndefined()
    expect(computePruningRatio(makeNode({}))).toBeUndefined()
  })

  it("returns undefined for a non-positive total or negative scanned count", () => {
    expect(computePruningRatio(makeNode({ pruning: { partitionsScanned: 5, partitionsTotal: 0 } }))).toBeUndefined()
    expect(computePruningRatio(makeNode({ pruning: { partitionsScanned: -5, partitionsTotal: 10_000 } }))).toBeUndefined()
  })

  it("does not throw on non-finite input", () => {
    expect(() => computePruningRatio(makeNode({ pruning: { partitionsScanned: Number.NaN, partitionsTotal: 10_000 } }))).not.toThrow()
  })
})

describe("isPruningPoor", () => {
  it("is true for a high scanned ratio on a large table (the story's own 9800/10000 example)", () => {
    expect(isPruningPoor(makeNode({ pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 } }))).toBe(true)
  })

  it("is false for a low scanned ratio on a large table (the story's own 50/10000 example)", () => {
    expect(isPruningPoor(makeNode({ pruning: { partitionsScanned: 50, partitionsTotal: 10_000 } }))).toBe(false)
  })

  it("is false when there isn't enough data to judge", () => {
    expect(isPruningPoor(makeNode({}))).toBe(false)
  })
})
