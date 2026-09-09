import { describe, expect, it } from "vitest"
import { isNativeInputRows, resolveInputRows } from "../inputRowsDetail"
import { makeNode } from "./testHelpers"

describe("resolveInputRows", () => {
  it("prefers the native inputRows when present", () => {
    const child = makeNode({ actualRows: 100 })
    const node = makeNode({ inputRows: 5000, children: [child] })
    expect(resolveInputRows(node)).toBe(5000)
  })

  it("falls back to the max of children's actualRows when inputRows is absent", () => {
    const childA = makeNode({ actualRows: 100 })
    const childB = makeNode({ actualRows: 500 })
    const node = makeNode({ children: [childA, childB] })
    expect(resolveInputRows(node)).toBe(500)
  })

  it("falls back to a child's estimatedRows when actualRows is absent (estimate-only plan)", () => {
    const child = makeNode({ estimatedRows: 250 })
    const node = makeNode({ children: [child] })
    expect(resolveInputRows(node)).toBe(250)
  })

  it("ignores a non-positive native inputRows and falls back", () => {
    const child = makeNode({ actualRows: 100 })
    const node = makeNode({ inputRows: 0, children: [child] })
    expect(resolveInputRows(node)).toBe(100)
  })

  it("returns undefined when neither source has anything usable", () => {
    const node = makeNode({ children: [makeNode({})] })
    expect(resolveInputRows(node)).toBeUndefined()
  })

  it("returns undefined for a childless node with no native inputRows", () => {
    const node = makeNode({})
    expect(resolveInputRows(node)).toBeUndefined()
  })
})

describe("isNativeInputRows", () => {
  it("is true when inputRows is a positive finite number", () => {
    expect(isNativeInputRows(makeNode({ inputRows: 10 }))).toBe(true)
  })

  it("is false when inputRows is absent", () => {
    expect(isNativeInputRows(makeNode({}))).toBe(false)
  })

  it("is false when inputRows is zero or negative", () => {
    expect(isNativeInputRows(makeNode({ inputRows: 0 }))).toBe(false)
    expect(isNativeInputRows(makeNode({ inputRows: -5 }))).toBe(false)
  })
})
