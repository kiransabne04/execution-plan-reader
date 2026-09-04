import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { CanvasPlanGraph } from "../CanvasPlanGraph"
import type { PlanGraphNode } from "../../buildGraphElements"
import { makeNode } from "../../../rules/__tests__/testHelpers"

function fixedRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

// jsdom has no real layout engine (every element's getBoundingClientRect is
// 0x0x0x0 by default) and no real 2d canvas context — see the "Not
// implemented: HTMLCanvasElement's getContext()" note CanvasPlanGraph.tsx
// itself guards against. These tests stub a fixed viewport size so the
// component's own fit-to-view/hit-testing math (already unit-tested in
// isolation via viewportTransform.test.ts/hitTest.test.ts) can be
// exercised end-to-end through real pointer events, without needing the
// `canvas` npm package installed.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(fixedRect(800, 600))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function singleNode(id = "a"): PlanGraphNode {
  return {
    id,
    type: "planNode",
    position: { x: 0, y: 0 },
    width: 160,
    height: 56,
    data: {
      kind: "plan",
      planNode: makeNode({ id }),
      width: 160,
      height: 56,
      color: "hsl(0, 70%, 55%)",
      hasMismatch: false,
      iconKey: "unknown",
      childCount: 0,
      isDimmed: false,
    },
  }
}

describe("CanvasPlanGraph", () => {
  it("renders a canvas surface hidden from assistive technology (AccessiblePlanList is the real interactive surface — Story 15.2)", () => {
    render(<CanvasPlanGraph nodes={[singleNode()]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    expect(canvas).toHaveAttribute("aria-hidden", "true")
    expect(canvas.tagName).toBe("CANVAS")
  })

  it("renders without crashing even though jsdom's getContext('2d') returns null", () => {
    expect(() =>
      render(<CanvasPlanGraph nodes={[singleNode(), singleNode("b")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />),
    ).not.toThrow()
  })

  it("clicking the node under the pointer calls onSelectNode with its id (fit-to-view centers the sole node at the viewport center)", () => {
    const onSelectNode = vi.fn()
    render(<CanvasPlanGraph nodes={[singleNode("only")]} edges={[]} onSelectNode={onSelectNode} onExpandCollapsedGroup={vi.fn()} />)

    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    // fitTransform centers the (sole) node's bounds in the 800x600
    // viewport — the viewport center is guaranteed to land on the node
    // regardless of the exact computed scale.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 300 })

    expect(onSelectNode).toHaveBeenCalledWith("only")
  })

  it("clicking empty space (far from any node) calls neither callback", () => {
    const onSelectNode = vi.fn()
    render(<CanvasPlanGraph nodes={[singleNode("only")]} edges={[]} onSelectNode={onSelectNode} onExpandCollapsedGroup={vi.fn()} />)

    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5 })

    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it("a drag gesture (movement past the threshold) pans instead of selecting — no onSelectNode call", () => {
    const onSelectNode = vi.fn()
    render(<CanvasPlanGraph nodes={[singleNode("only")]} edges={[]} onSelectNode={onSelectNode} onExpandCollapsedGroup={vi.fn()} />)

    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 460, clientY: 300 }) // well past DRAG_THRESHOLD_PX
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 460, clientY: 300 })

    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it("clicking a collapsed-group placeholder calls onExpandCollapsedGroup with its parent node id, not onSelectNode", () => {
    const groupNode: PlanGraphNode = {
      id: "n::collapsed",
      type: "collapsedGroup",
      position: { x: 0, y: 0 },
      width: 160,
      height: 48,
      data: { kind: "collapsed-group", hiddenNodeCount: 5, parentPlanNodeId: "n" },
    }
    const onSelectNode = vi.fn()
    const onExpandCollapsedGroup = vi.fn()
    render(<CanvasPlanGraph nodes={[groupNode]} edges={[]} onSelectNode={onSelectNode} onExpandCollapsedGroup={onExpandCollapsedGroup} />)

    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 300 })

    expect(onExpandCollapsedGroup).toHaveBeenCalledWith("n")
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  it("a wheel event does not throw (zoom path exercised, no assertion on the unrenderable pixel result)", () => {
    render(<CanvasPlanGraph nodes={[singleNode()]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
    const canvas = screen.getByTestId("canvas-plan-graph-surface")
    expect(() => fireEvent.wheel(canvas, { clientX: 400, clientY: 300, deltaY: -100 })).not.toThrow()
  })

  describe("Episode 22, Story 22.3 — onSelectedNodeScreenAnchorChange", () => {
    it("reports the selected node's screen anchor, combining worldToScreen with the canvas element's own bounding rect", () => {
      const onAnchorChange = vi.fn()
      render(
        <CanvasPlanGraph
          nodes={[singleNode("only")]}
          edges={[]}
          selectedNodeId="only"
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )

      expect(onAnchorChange).toHaveBeenCalled()
      const anchor = onAnchorChange.mock.calls.at(-1)![0]
      expect(anchor).toBeDefined()
      // fitTransform centers the sole node in the 800x600 mocked viewport —
      // its anchor's center should land near the viewport's own center.
      expect(anchor.x + anchor.width / 2).toBeCloseTo(400, 0)
      expect(anchor.y + anchor.height / 2).toBeCloseTo(300, 0)
    })

    it("reports undefined when nothing is selected", () => {
      const onAnchorChange = vi.fn()
      render(
        <CanvasPlanGraph
          nodes={[singleNode("only")]}
          edges={[]}
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )
      expect(onAnchorChange).toHaveBeenLastCalledWith(undefined)
    })

    it("re-reports a new anchor as the transform changes (a drag/pan) — the live-repositioning mechanism, not a one-shot value", () => {
      const onAnchorChange = vi.fn()
      render(
        <CanvasPlanGraph
          nodes={[singleNode("only")]}
          edges={[]}
          selectedNodeId="only"
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )
      const beforePan = onAnchorChange.mock.calls.at(-1)![0]
      onAnchorChange.mockClear()

      const canvas = screen.getByTestId("canvas-plan-graph-surface")
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 460, clientY: 340 }) // past DRAG_THRESHOLD_PX
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 460, clientY: 340 })

      expect(onAnchorChange).toHaveBeenCalled()
      const afterPan = onAnchorChange.mock.calls.at(-1)![0]
      expect(afterPan.x).toBeCloseTo(beforePan.x + 60, 0)
      expect(afterPan.y).toBeCloseTo(beforePan.y + 40, 0)
    })

    it("never fires (no-op) when the callback prop is omitted — additive, changes nothing for existing 'panel'-mode callers", () => {
      expect(() =>
        render(<CanvasPlanGraph nodes={[singleNode("only")]} edges={[]} selectedNodeId="only" onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />),
      ).not.toThrow()
    })
  })

  describe("Episode 26, Story 26.1 — panToNodeId", () => {
    function twoNodesFarApart(): PlanGraphNode[] {
      return [singleNode("near"), { ...singleNode("far"), position: { x: 4000, y: 4000 } }]
    }

    it("pans to the requested node at the CURRENT scale, then calls onPanHandled — never a freshly fit-computed scale", () => {
      const onPanHandled = vi.fn()
      const onAnchorChange = vi.fn()
      const { rerender } = render(
        <CanvasPlanGraph
          nodes={twoNodesFarApart()}
          edges={[]}
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )
      // fit-to-view (both nodes 4000px apart in an 800x600 viewport) lands
      // on a small scale — capture it via the anchor width it reports for
      // "near" once we select it below, so the pan's own scale can be
      // compared against the SAME basis rather than an assumed constant.

      rerender(
        <CanvasPlanGraph
          nodes={twoNodesFarApart()}
          edges={[]}
          selectedNodeId="far"
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )
      const beforePanScale = onAnchorChange.mock.calls.at(-1)![0].width / 160 // anchor.width = nodeWidth * scale
      onAnchorChange.mockClear()

      rerender(
        <CanvasPlanGraph
          nodes={twoNodesFarApart()}
          edges={[]}
          selectedNodeId="far"
          panToNodeId="far"
          onPanHandled={onPanHandled}
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
          onSelectedNodeScreenAnchorChange={onAnchorChange}
        />,
      )

      expect(onPanHandled).toHaveBeenCalledTimes(1)
      const afterPanAnchor = onAnchorChange.mock.calls.at(-1)![0]
      const afterPanScale = afterPanAnchor.width / 160
      // Same scale as before the pan (within floating-point tolerance) —
      // the whole point of `panToTransform` over `fitTransform`.
      expect(afterPanScale).toBeCloseTo(beforePanScale, 6)
      // "far"'s anchor is now centered in the 800x600 viewport — the pan
      // actually moved the camera, not a no-op.
      expect(afterPanAnchor.x + afterPanAnchor.width / 2).toBeCloseTo(400, 0)
      expect(afterPanAnchor.y + afterPanAnchor.height / 2).toBeCloseTo(300, 0)
    })

    it("does nothing (no throw, no onPanHandled call) for a node id not present in `nodes` — e.g. still hidden behind a collapsed ancestor the caller hasn't expanded yet", () => {
      const onPanHandled = vi.fn()
      render(
        <CanvasPlanGraph
          nodes={[singleNode("only")]}
          edges={[]}
          panToNodeId="not-yet-visible"
          onPanHandled={onPanHandled}
          onSelectNode={vi.fn()}
          onExpandCollapsedGroup={vi.fn()}
        />,
      )
      expect(onPanHandled).not.toHaveBeenCalled()
    })
  })

  describe("Episode 26, Story 26.1 — hover tooltip", () => {
    function nodeWithPredicate(id: string): PlanGraphNode {
      const node = singleNode(id)
      return { ...node, data: { ...node.data, planNode: makeNode({ id, predicate: { filter: "x > 1" } }) } }
    }

    it("shows a tooltip for the node under the pointer once it has a predicate/seek/join condition", () => {
      render(<CanvasPlanGraph nodes={[nodeWithPredicate("only")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
      const canvas = screen.getByTestId("canvas-plan-graph-surface")

      expect(screen.queryByTestId("canvas-plan-graph-tooltip")).not.toBeInTheDocument()
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      expect(screen.getByTestId("canvas-plan-graph-tooltip")).toHaveTextContent("Filter: x > 1")
    })

    it("shows nothing for a node with no predicate/seek/join condition", () => {
      render(<CanvasPlanGraph nodes={[singleNode("only")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
      const canvas = screen.getByTestId("canvas-plan-graph-surface")
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      expect(screen.queryByTestId("canvas-plan-graph-tooltip")).not.toBeInTheDocument()
    })

    it("hides again once the pointer moves off the node, and on pointer leave", () => {
      render(<CanvasPlanGraph nodes={[nodeWithPredicate("only")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
      const canvas = screen.getByTestId("canvas-plan-graph-surface")

      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      expect(screen.getByTestId("canvas-plan-graph-tooltip")).toBeInTheDocument()

      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 5, clientY: 5 })
      expect(screen.queryByTestId("canvas-plan-graph-tooltip")).not.toBeInTheDocument()

      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      expect(screen.getByTestId("canvas-plan-graph-tooltip")).toBeInTheDocument()
      fireEvent.pointerLeave(canvas)
      expect(screen.queryByTestId("canvas-plan-graph-tooltip")).not.toBeInTheDocument()
    })

    it("suppresses the tooltip once an actual drag (pan) is underway", () => {
      render(<CanvasPlanGraph nodes={[nodeWithPredicate("only")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
      const canvas = screen.getByTestId("canvas-plan-graph-surface")

      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      expect(screen.getByTestId("canvas-plan-graph-tooltip")).toBeInTheDocument()

      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 460, clientY: 300 }) // past DRAG_THRESHOLD_PX
      expect(screen.queryByTestId("canvas-plan-graph-tooltip")).not.toBeInTheDocument()
    })
  })

  it("pauses scheduling a redraw while the tab is hidden (rule 5)", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame")
    const { rerender } = render(<CanvasPlanGraph nodes={[singleNode("a")]} edges={[]} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
    rafSpy.mockClear()

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    document.dispatchEvent(new Event("visibilitychange"))

    // A prop change that would normally trigger a redraw (selection change).
    rerender(<CanvasPlanGraph nodes={[singleNode("a")]} edges={[]} selectedNodeId="a" onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    expect(rafSpy).not.toHaveBeenCalled()

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    document.dispatchEvent(new Event("visibilitychange"))
  })
})
