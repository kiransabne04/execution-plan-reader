import { describe, expect, it } from "vitest"
import { computeExportLayout } from "../exportPng"
import type { PlanGraphNode, PlanNodeData } from "../../buildGraphElements"
import { makeNode } from "../../../rules/__tests__/testHelpers"

function planGraphNode(
  id: string,
  x: number,
  y: number,
  overrides: Partial<Omit<PlanNodeData, "kind" | "planNode">> & { width?: number; height?: number } = {},
): PlanGraphNode {
  const width = overrides.width ?? 160
  const height = overrides.height ?? 56
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
      loopCount: undefined,
      iconKey: "unknown",
      childCount: 0,
      isDimmed: false,
      ...overrides,
    },
  }
}

describe("computeExportLayout", () => {
  it("returns null for an empty node set — an honest result, not a degenerate 0x0 canvas", () => {
    expect(computeExportLayout([])).toBeNull()
  })

  it("renders at 1:1 (world unit = pixel) for a small plan, with padding on every side", () => {
    const nodes = [planGraphNode("a", 0, 0), planGraphNode("b", 0, 100)]
    const layout = computeExportLayout(nodes)!
    expect(layout.transform.scale).toBe(1)
    // Bounds: x in [0,160], y in [0,156] (second node's own 56px height
    // added to its y=100 position) -> width 160, height 156, plus 40px
    // padding on every side.
    expect(layout.width).toBe(160 + 80)
    expect(layout.height).toBe(156 + 80)
  })

  it("positions the first node's top-left at exactly the padding offset", () => {
    const nodes = [planGraphNode("a", 50, 50)]
    const layout = computeExportLayout(nodes)!
    // world (50,50) -> screen (50*scale + transform.x). scale is 1 here
    // (single 160x56 node comfortably under the size cap).
    expect(layout.transform.x + 50 * layout.transform.scale).toBe(40)
    expect(layout.transform.y + 50 * layout.transform.scale).toBe(40)
  })

  it("downscales proportionally, never upscales, when raw bounds would exceed the export size cap", () => {
    // A long single-child chain, well beyond MAX_EXPORT_DIMENSION_PX
    // (8000px) in world units.
    const nodes = Array.from({ length: 200 }, (_, i) => planGraphNode(`n${i}`, 0, i * 100))
    const layout = computeExportLayout(nodes)!
    expect(layout.transform.scale).toBeLessThan(1)
    expect(layout.transform.scale).toBeGreaterThan(0)
    // The capped dimension (height, since this chain is tall and narrow)
    // stays within the documented cap plus padding.
    expect(layout.height).toBeLessThanOrEqual(8000 + 80)
  })
})
