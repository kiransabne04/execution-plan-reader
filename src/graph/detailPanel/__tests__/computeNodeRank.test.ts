import { describe, expect, it } from "vitest"
import { computeNodeRank, formatOrdinal } from "../computeNodeRank"
import { makeContext, makeNode } from "../../../rules/__tests__/testHelpers"

describe("computeNodeRank", () => {
  it("ranks by actualTimeMs, descending, matching the mock's '3rd slowest of N' wording", () => {
    const slow = makeNode({ id: "slow", actualTimeMs: 500 })
    const mid = makeNode({ id: "mid", actualTimeMs: 300 })
    const target = makeNode({ id: "target", actualTimeMs: 120 })
    const fast = makeNode({ id: "fast", actualTimeMs: 10 })
    const root = makeNode({ id: "root", actualTimeMs: 500, children: [slow, mid, target, fast] })
    const context = makeContext(root)

    expect(computeNodeRank(target, context)).toEqual({ rank: 4, total: 5 }) // root + 4 children, root ties slow at 500 but sorts stably
  })

  it("falls back to estimatedCost when actualTimeMs is absent (estimate-only plan)", () => {
    const a = makeNode({ id: "a", estimatedCost: 1000 })
    const b = makeNode({ id: "b", estimatedCost: 10 })
    const root = makeNode({ id: "root", estimatedCost: 1000, children: [a, b] })
    const context = makeContext(root)
    expect(computeNodeRank(b, context)).toEqual({ rank: 3, total: 3 })
  })

  it("returns undefined when this node has no comparable figure at all", () => {
    const a = makeNode({ id: "a", actualTimeMs: 5 })
    const target = makeNode({ id: "target" }) // no actualTimeMs, no estimatedCost
    const root = makeNode({ id: "root", actualTimeMs: 5, children: [a, target] })
    const context = makeContext(root)
    expect(computeNodeRank(target, context)).toBeUndefined()
  })

  it("returns undefined for a single-node plan (a rank of '1st of 1' is not a useful chip)", () => {
    const root = makeNode({ id: "root", actualTimeMs: 5 })
    const context = makeContext(root)
    expect(computeNodeRank(root, context)).toBeUndefined()
  })
})

describe("formatOrdinal", () => {
  it("handles the 1st/2nd/3rd/4th cases and the 11th/12th/13th exceptions", () => {
    expect(formatOrdinal(1)).toBe("1st")
    expect(formatOrdinal(2)).toBe("2nd")
    expect(formatOrdinal(3)).toBe("3rd")
    expect(formatOrdinal(4)).toBe("4th")
    expect(formatOrdinal(11)).toBe("11th")
    expect(formatOrdinal(12)).toBe("12th")
    expect(formatOrdinal(13)).toBe("13th")
    expect(formatOrdinal(21)).toBe("21st")
    expect(formatOrdinal(101)).toBe("101st")
  })
})
