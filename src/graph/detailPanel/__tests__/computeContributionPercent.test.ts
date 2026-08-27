import { describe, expect, it } from "vitest"
import { computeContributionPercent } from "../computeContributionPercent"
import { makeNode, makeContext } from "../../../rules/__tests__/testHelpers"

describe("computeContributionPercent", () => {
  it("returns 100 for the root node by definition (root value / root value)", () => {
    const root = makeNode({ actualTimeMs: 42 })
    expect(computeContributionPercent(root, makeContext(root))).toBe(100)
  })

  it("computes a child's share of the total plan time", () => {
    const child = makeNode({ id: "child", actualTimeMs: 25 })
    const root = makeNode({ id: "root", actualTimeMs: 100, children: [child] })
    const context = makeContext(root)
    expect(computeContributionPercent(child, context)).toBe(25)
  })

  it("falls back to estimatedCost when actualTimeMs is absent (estimate-only plan)", () => {
    const child = makeNode({ id: "child", estimatedCost: 10 })
    const root = makeNode({ id: "root", estimatedCost: 40, children: [child] })
    expect(computeContributionPercent(child, makeContext(root))).toBe(25)
  })

  it("returns undefined (never NaN) when the plan total is zero", () => {
    const root = makeNode({ actualTimeMs: 0, estimatedCost: 0 })
    const result = computeContributionPercent(root, makeContext(root))
    expect(result).toBeUndefined()
  })

  it("returns undefined when the plan total is missing entirely", () => {
    const root = makeNode({})
    expect(computeContributionPercent(root, makeContext(root))).toBeUndefined()
  })

  it("returns undefined for a node with no comparable metric of its own", () => {
    const child = makeNode({ id: "child" })
    const root = makeNode({ id: "root", actualTimeMs: 100, children: [child] })
    expect(computeContributionPercent(child, makeContext(root))).toBeUndefined()
  })

  it("never returns NaN or Infinity for any combination of zero/undefined inputs", () => {
    for (const total of [0, undefined, -5]) {
      for (const value of [0, undefined, -5]) {
        const child = makeNode({ id: "c", actualTimeMs: value })
        const root = makeNode({ id: "r", actualTimeMs: total, children: [child] })
        const result = computeContributionPercent(child, makeContext(root))
        if (result !== undefined) {
          expect(Number.isFinite(result)).toBe(true)
        }
      }
    }
  })
})
