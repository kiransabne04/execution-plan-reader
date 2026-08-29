import { describe, expect, it } from "vitest"
import { findNodeAtPoint } from "../hitTest"
import type { PlanGraphNode } from "../../buildGraphElements"
import { makeNode } from "../../../rules/__tests__/testHelpers"

function planNode(id: string, x: number, y: number, width = 160, height = 56): PlanGraphNode {
  return {
    id,
    type: "planNode",
    position: { x, y },
    width,
    height,
    data: {
      kind: "plan",
      planNode: makeNode({ id }),
      width,
      height,
      color: "hsl(0, 70%, 55%)",
      hasMismatch: false,
      iconKey: "unknown",
      childCount: 0,
      isDimmed: false,
    },
  }
}

describe("findNodeAtPoint", () => {
  it("finds the node whose bounding box contains the point", () => {
    const nodes = [planNode("a", 0, 0), planNode("b", 300, 0)]
    expect(findNodeAtPoint(nodes, { x: 10, y: 10 })?.id).toBe("a")
    expect(findNodeAtPoint(nodes, { x: 310, y: 10 })?.id).toBe("b")
  })

  it("returns undefined for a point in empty space between nodes", () => {
    const nodes = [planNode("a", 0, 0), planNode("b", 300, 0)]
    expect(findNodeAtPoint(nodes, { x: 200, y: 10 })).toBeUndefined()
  })

  it("returns undefined for an empty node list", () => {
    expect(findNodeAtPoint([], { x: 0, y: 0 })).toBeUndefined()
  })

  it("treats the bounding box as inclusive at its edges", () => {
    const nodes = [planNode("a", 0, 0, 160, 56)]
    expect(findNodeAtPoint(nodes, { x: 0, y: 0 })?.id).toBe("a") // top-left corner
    expect(findNodeAtPoint(nodes, { x: 160, y: 56 })?.id).toBe("a") // bottom-right corner
    expect(findNodeAtPoint(nodes, { x: 161, y: 10 })).toBeUndefined()
  })

  it("resolves an overlap to the last node in the array (drawn on top)", () => {
    const nodes = [planNode("under", 0, 0, 200, 200), planNode("over", 50, 50, 60, 60)]
    expect(findNodeAtPoint(nodes, { x: 70, y: 70 })?.id).toBe("over")
  })

  it("works correctly at a non-default (zoomed/panned) coordinate — pure math, no transform assumptions baked in", () => {
    // The caller is responsible for converting screen -> world before
    // calling this; this test just confirms arbitrary world coordinates
    // (not starting near the origin) still hit-test correctly.
    const nodes = [planNode("far", 5000, -2000, 160, 56)]
    expect(findNodeAtPoint(nodes, { x: 5080, y: -1972 })?.id).toBe("far")
    expect(findNodeAtPoint(nodes, { x: 0, y: 0 })).toBeUndefined()
  })
})
