import { describe, expect, it } from "vitest"
import { computeWalkthroughSteps } from "../walkthroughSteps"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import { buildPlanContext } from "../../../rules/types"

describe("computeWalkthroughSteps", () => {
  it("always includes the root, even with zero warnings and low contribution", () => {
    const root = makeNode({ id: "root", actualTimeMs: 10 })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    expect(result.steps.map((n) => n.id)).toEqual(["root"])
    expect(result.isMinimal).toBe(true)
  })

  it("is post-order — leaves/children appear before their own parent", () => {
    const leaf = makeNode({ id: "leaf", actualTimeMs: 8, warnings: [{ ruleId: "x", severity: "warning", shortText: "a", longText: "b" }] })
    const mid = makeNode({
      id: "mid",
      actualTimeMs: 9,
      children: [leaf],
      warnings: [{ ruleId: "y", severity: "warning", shortText: "a", longText: "b" }],
    })
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [mid] })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    expect(result.steps.map((n) => n.id)).toEqual(["leaf", "mid", "root"])
  })

  it("includes a node carrying a warning regardless of its contribution percent", () => {
    const flagged = makeNode({
      id: "flagged",
      actualTimeMs: 0.001, // negligible contribution
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "a", longText: "b" }],
    })
    const clean = makeNode({ id: "clean", actualTimeMs: 0.001 })
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [flagged, clean] })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    expect(result.steps.map((n) => n.id)).toContain("flagged")
    expect(result.steps.map((n) => n.id)).not.toContain("clean")
  })

  it("includes a node at or above 10% contribution even with no warnings", () => {
    const big = makeNode({ id: "big", actualTimeMs: 5 }) // 5/10 = 50%
    const small = makeNode({ id: "small", actualTimeMs: 0.1 }) // 1%
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [big, small] })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    expect(result.steps.map((n) => n.id)).toContain("big")
    expect(result.steps.map((n) => n.id)).not.toContain("small")
  })

  it("isMinimal is false once anything beyond the root qualifies", () => {
    const big = makeNode({ id: "big", actualTimeMs: 5 })
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [big] })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    expect(result.isMinimal).toBe(false)
    expect(result.steps).toHaveLength(2)
  })

  it("visits a shared-reference (multi-parent) node only once, at its first-reached position", () => {
    const shared = makeNode({ id: "shared", actualTimeMs: 6 }) // 60% — qualifies
    const parentA = makeNode({ id: "parentA", actualTimeMs: 6, children: [shared] })
    const parentB = makeNode({ id: "parentB", actualTimeMs: 6, children: [shared] })
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [parentA, parentB] })
    const result = computeWalkthroughSteps(root, buildPlanContext(root))
    const ids = result.steps.map((n) => n.id)
    expect(ids.filter((id) => id === "shared")).toHaveLength(1)
    expect(ids.indexOf("shared")).toBeLessThan(ids.indexOf("parentA"))
  })
})
