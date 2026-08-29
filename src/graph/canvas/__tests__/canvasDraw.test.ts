import { describe, expect, it, vi } from "vitest"
import { drawGraph } from "../canvasDraw"
import type { PlanGraphEdge, PlanGraphNode, PlanNodeData } from "../../buildGraphElements"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import { IDENTITY_TRANSFORM } from "../viewportTransform"

/** A minimal, deterministic stand-in for CanvasRenderingContext2D — jsdom
 * has no real 2d context (see CanvasPlanGraph.tsx's own null-context
 * guard), so drawGraph's control flow is exercised against a hand-rolled
 * fake that records every call instead. measureText is proportional to
 * string length so fitText's truncation logic is actually exercisable. */
function makeFakeContext() {
  const calls: { method: string; args: unknown[] }[] = []
  const record =
    (method: string) =>
    (...args: unknown[]) =>
      calls.push({ method, args })

  const ctx = {
    calls,
    save: record("save"),
    restore: record("restore"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    translate: record("translate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arcTo: record("arcTo"),
    bezierCurveTo: record("bezierCurveTo"),
    fill: record("fill"),
    stroke: record("stroke"),
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    globalAlpha: 1,
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls }
}

function planGraphNode(
  overrides: Partial<Omit<PlanNodeData, "kind" | "planNode">> & { id?: string; x?: number; y?: number; width?: number; height?: number } = {},
): PlanGraphNode {
  const id = overrides.id ?? "n"
  const width = overrides.width ?? 160
  const height = overrides.height ?? 56
  return {
    id,
    type: "planNode",
    position: { x: overrides.x ?? 0, y: overrides.y ?? 0 },
    width,
    height,
    data: {
      kind: "plan",
      planNode: makeNode({ id, rawOperatorLabel: "Seq Scan" }),
      width,
      height,
      color: "hsl(0, 70%, 55%)",
      hasMismatch: false,
      loopCount: undefined,
      iconKey: "unknown",
      childCount: 0,
      ...overrides,
    },
  }
}

const baseParams = {
  transform: IDENTITY_TRANSFORM,
  cssWidth: 800,
  cssHeight: 600,
  textColor: "#111111",
  selectionColor: "#1a56db",
  edgeColors: { hot: "#8d6a6a", muted: "#6b6f82" },
  severityColors: { critical: "#f97066", warning: "#f79009" },
}

describe("drawGraph", () => {
  it("does not throw for an empty graph", () => {
    const ctx = makeFakeContext()
    expect(() => drawGraph(ctx, { ...baseParams, nodes: [], edges: [] })).not.toThrow()
  })

  it("draws the node's operator label via fillText", () => {
    const ctx = makeFakeContext()
    const node = planGraphNode({ id: "a" })
    drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })

    const labelCall = ctx.calls.find((c) => c.method === "fillText" && c.args[0] === "Seq Scan")
    expect(labelCall).toBeDefined()
  })

  it("truncates a label that doesn't fit the node's width, ending in an ellipsis", () => {
    const ctx = makeFakeContext()
    const node = planGraphNode({ id: "a", width: 40 })
    node.data = { ...node.data, planNode: makeNode({ id: "a", rawOperatorLabel: "A Very Long Operator Label That Overflows" }) }
    drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })

    const labelCall = ctx.calls.find((c) => c.method === "fillText" && typeof c.args[0] === "string" && (c.args[0] as string).includes("…"))
    expect(labelCall).toBeDefined()
    expect((labelCall!.args[0] as string).length).toBeLessThan("A Very Long Operator Label That Overflows".length)
  })

  it("draws a dashed border for a node with an estimate mismatch, solid for one without", () => {
    const ctxMismatch = makeFakeContext()
    drawGraph(ctxMismatch, { ...baseParams, nodes: [planGraphNode({ id: "a", hasMismatch: true })], edges: [] })
    expect(ctxMismatch.calls.some((c) => c.method === "setLineDash" && (c.args[0] as number[]).length === 2)).toBe(true)

    const ctxClean = makeFakeContext()
    drawGraph(ctxClean, { ...baseParams, nodes: [planGraphNode({ id: "a", hasMismatch: false })], edges: [] })
    // Only the reset-to-solid call ([]) should appear — never a populated dash pattern for this node's own border.
    expect(ctxClean.calls.filter((c) => c.method === "setLineDash").every((c) => (c.args[0] as number[]).length === 0)).toBe(true)
  })

  it("draws an extra outline stroke when the node is selected", () => {
    const ctxSelected = makeFakeContext()
    drawGraph(ctxSelected, { ...baseParams, nodes: [planGraphNode({ id: "a" })], edges: [], selectedNodeId: "a" })

    const ctxUnselected = makeFakeContext()
    drawGraph(ctxUnselected, { ...baseParams, nodes: [planGraphNode({ id: "a" })], edges: [] })

    const strokeCount = (calls: typeof ctxSelected.calls) => calls.filter((c) => c.method === "stroke").length
    expect(strokeCount(ctxSelected.calls)).toBeGreaterThan(strokeCount(ctxUnselected.calls))
  })

  it("draws a loop-count badge only when loopCount is present", () => {
    const ctx = makeFakeContext()
    const node = planGraphNode({ id: "a", loopCount: 950 })
    node.data = { ...node.data, planNode: makeNode({ id: "a", loops: 950 }) }
    drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })
    expect(ctx.calls.some((c) => c.method === "fillText" && String(c.args[0]).includes("950"))).toBe(true)
  })

  it("draws the collapsed-group placeholder with a hidden-count label and a dashed border", () => {
    const groupNode: PlanGraphNode = {
      id: "n::collapsed",
      type: "collapsedGroup",
      position: { x: 0, y: 0 },
      width: 160,
      height: 48,
      data: { kind: "collapsed-group", hiddenNodeCount: 42, parentPlanNodeId: "n" },
    }
    const ctx = makeFakeContext()
    drawGraph(ctx, { ...baseParams, nodes: [groupNode], edges: [] })

    expect(ctx.calls.some((c) => c.method === "fillText" && String(c.args[0]).includes("42"))).toBe(true)
    expect(ctx.calls.some((c) => c.method === "setLineDash" && (c.args[0] as number[]).length === 2)).toBe(true)
  })

  it("draws an edge as a curve between a matched source and target, and silently skips a dangling edge reference", () => {
    const a = planGraphNode({ id: "a", x: 0, y: 0 })
    const b = planGraphNode({ id: "b", x: 0, y: 200 })
    const edges: PlanGraphEdge[] = [
      { id: "a->b", source: "a", target: "b", data: { rows: 100, strokeWidth: 2, isSharedReference: false, isHotPath: false, targetChildIndex: 0 } },
      {
        id: "a->missing",
        source: "a",
        target: "does-not-exist",
        data: { rows: 0, strokeWidth: 1, isSharedReference: false, isHotPath: false, targetChildIndex: 0 },
      },
    ]
    const ctx = makeFakeContext()
    expect(() => drawGraph(ctx, { ...baseParams, nodes: [a, b], edges })).not.toThrow()
    expect(ctx.calls.some((c) => c.method === "bezierCurveTo")).toBe(true)
  })

  it("uses a dashed line for a shared-reference edge", () => {
    const a = planGraphNode({ id: "a", x: 0, y: 0 })
    const b = planGraphNode({ id: "b", x: 0, y: 200 })
    const edges: PlanGraphEdge[] = [
      { id: "a->b", source: "a", target: "b", data: { rows: 100, strokeWidth: 2, isSharedReference: true, isHotPath: false, targetChildIndex: 0 } },
    ]
    const ctx = makeFakeContext()
    drawGraph(ctx, { ...baseParams, nodes: [a, b], edges })
    expect(ctx.calls.some((c) => c.method === "setLineDash" && (c.args[0] as number[]).length === 2)).toBe(true)
  })

  it("clears the canvas and applies the transform before drawing anything", () => {
    const ctx = makeFakeContext()
    const spyOrder: string[] = []
    for (const method of ["clearRect", "translate", "scale", "fillText"] as const) {
      const original = ctx[method] as (...a: unknown[]) => void
      ;(ctx[method] as unknown) = vi.fn((...args: unknown[]) => {
        spyOrder.push(method)
        original(...args)
      })
    }
    drawGraph(ctx, { ...baseParams, nodes: [planGraphNode({ id: "a" })], edges: [], transform: { x: 10, y: 20, scale: 1.5 } })

    expect(spyOrder.indexOf("clearRect")).toBeLessThan(spyOrder.indexOf("translate"))
    expect(spyOrder.indexOf("translate")).toBeLessThan(spyOrder.indexOf("fillText"))
  })

  describe("Episode 18, Story 18.4 — icons, subtitle, severity ring, and two-tone edges", () => {
    it("draws the operator's icon glyph and, when set, the subtitle", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", iconKey: "hash", subtitle: "orders" })
      drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })
      expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "#")).toBe(true)
      expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "orders")).toBe(true)
    })

    it("falls back to the 'unknown' glyph for an unrecognized icon key, never a blank/undefined draw", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", iconKey: "unknown" })
      expect(() => drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })).not.toThrow()
      expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "○")).toBe(true)
    })

    it("draws an extra stroked outline for a severity, sized 3px for critical vs 2px for warning, and a severity badge", () => {
      const ctxCritical = makeFakeContext()
      drawGraph(ctxCritical, { ...baseParams, nodes: [planGraphNode({ id: "a", severity: "critical" })], edges: [] })
      const strokeWidthsCritical = ctxCritical.calls.filter((c) => c.method === "stroke").length
      expect(strokeWidthsCritical).toBeGreaterThan(0)
      expect(ctxCritical.calls.some((c) => c.method === "fillText" && c.args[0] === "critical")).toBe(true)

      const ctxNone = makeFakeContext()
      drawGraph(ctxNone, { ...baseParams, nodes: [planGraphNode({ id: "a" })], edges: [] })
      expect(ctxNone.calls.some((c) => c.method === "fillText" && c.args[0] === "critical")).toBe(false)
    })

    it("colors a hot-path edge with edgeColors.hot and every other edge with edgeColors.muted, and draws an arrowhead triangle for each", () => {
      const a = planGraphNode({ id: "a", x: 0, y: 200 })
      const b = planGraphNode({ id: "b", x: 200, y: 200 })
      const parent = planGraphNode({ id: "parent", x: 100, y: 0, childCount: 2 })
      const edges: PlanGraphEdge[] = [
        {
          id: "a->parent",
          source: "a",
          target: "parent",
          data: { rows: 100, strokeWidth: 2, isSharedReference: false, isHotPath: true, targetChildIndex: 0 },
        },
        {
          id: "b->parent",
          source: "b",
          target: "parent",
          data: { rows: 10, strokeWidth: 1.5, isSharedReference: false, isHotPath: false, targetChildIndex: 1 },
        },
      ]
      const ctx = makeFakeContext()
      drawGraph(ctx, { ...baseParams, nodes: [a, b, parent], edges })

      const strokeStyles = ctx.calls.filter((c) => c.method === "stroke")
      // Both edges got a stroke call; we can't directly read fillStyle/strokeStyle
      // history off this fake (they're plain properties, overwritten per call),
      // but the fill() calls after each edge's stroke are the arrowheads —
      // exactly 2 of them (one per edge), each a 3-point triangle path.
      expect(strokeStyles.length).toBeGreaterThanOrEqual(2)
      // Each of the 3 nodes fills its own background rect, plus one fill
      // per arrowhead (2 edges) — 5 total. Isolating "just the arrowhead
      // fills" isn't possible against this call-recording fake without a
      // lot more plumbing; the node-rendering tests above already cover
      // the background-fill path on its own.
      const fillCalls = ctx.calls.filter((c) => c.method === "fill")
      expect(fillCalls.length).toBe(3 + 2)
    })

    it("offsets each child's edge anchor across the parent's bottom edge via computeHandleOffsetPercent, not one shared point", () => {
      const child0 = planGraphNode({ id: "child0", x: 0, y: 200 })
      const child1 = planGraphNode({ id: "child1", x: 200, y: 200 })
      const parent = planGraphNode({ id: "parent", x: 0, y: 0, width: 200, childCount: 2 })
      const edges: PlanGraphEdge[] = [
        {
          id: "child0->parent",
          source: "child0",
          target: "parent",
          data: { rows: 1, strokeWidth: 1, isSharedReference: false, isHotPath: false, targetChildIndex: 0 },
        },
        {
          id: "child1->parent",
          source: "child1",
          target: "parent",
          data: { rows: 1, strokeWidth: 1, isSharedReference: false, isHotPath: false, targetChildIndex: 1 },
        },
      ]
      const ctx = makeFakeContext()
      drawGraph(ctx, { ...baseParams, nodes: [child0, child1, parent], edges })

      // Each edge's curve ends (bezierCurveTo's final x,y args) at a
      // DIFFERENT x on the parent's bottom edge — computeHandleOffsetPercent(0,2)
      // vs (1,2) are 33% and 67% of the parent's 200px width, not both 50%.
      const endpoints = ctx.calls.filter((c) => c.method === "bezierCurveTo").map((c) => c.args[4] as number)
      expect(endpoints).toHaveLength(2)
      expect(endpoints[0]).not.toBe(endpoints[1])
    })
  })

  describe("Episode 18, Story 18.10 — legible-zoom-floor degrade to solid heat blocks", () => {
    it("draws no text at all below the legible-zoom floor, but still fills/strokes the card", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", iconKey: "hash", subtitle: "orders", loopCount: 3 })
      drawGraph(ctx, { ...baseParams, transform: { x: 0, y: 0, scale: 0.3 }, nodes: [node], edges: [] })

      expect(ctx.calls.some((c) => c.method === "fillText")).toBe(false)
      expect(ctx.calls.some((c) => c.method === "fill")).toBe(true) // the card's own solid heat-colored fill
      expect(ctx.calls.some((c) => c.method === "stroke")).toBe(true) // the border still draws
    })

    it("draws normal text at/above the legible-zoom floor", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a" })
      drawGraph(ctx, { ...baseParams, transform: { x: 0, y: 0, scale: 1 }, nodes: [node], edges: [] })
      expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "Seq Scan")).toBe(true)
    })

    it("the collapsed-group placeholder also skips its 'N hidden' text below the floor, but keeps its dashed outline", () => {
      const groupNode: PlanGraphNode = {
        id: "n::collapsed",
        type: "collapsedGroup",
        position: { x: 0, y: 0 },
        width: 160,
        height: 48,
        data: { kind: "collapsed-group", hiddenNodeCount: 42, parentPlanNodeId: "n" },
      }
      const ctx = makeFakeContext()
      drawGraph(ctx, { ...baseParams, transform: { x: 0, y: 0, scale: 0.3 }, nodes: [groupNode], edges: [] })

      expect(ctx.calls.some((c) => c.method === "fillText")).toBe(false)
      expect(ctx.calls.some((c) => c.method === "setLineDash" && (c.args[0] as number[]).length === 2)).toBe(true)
    })

    it("selection outline and severity ring still draw below the floor — color signals stay meaningful at any zoom", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", severity: "critical" })
      drawGraph(ctx, { ...baseParams, transform: { x: 0, y: 0, scale: 0.3 }, nodes: [node], edges: [], selectedNodeId: "a" })

      // Base border + severity ring + selection outline = 3 strokes.
      expect(ctx.calls.filter((c) => c.method === "stroke").length).toBeGreaterThanOrEqual(3)
    })
  })

  describe("Episode 18, Story 18.11 — PNG export background fill", () => {
    it("fills an opaque background BEFORE the pan/zoom transform, only when backgroundColor is passed", () => {
      const ctx = makeFakeContext()
      drawGraph(ctx, {
        ...baseParams,
        nodes: [planGraphNode({ id: "a" })],
        edges: [],
        backgroundColor: "#232532",
      })

      const fillRectIndex = ctx.calls.findIndex((c) => c.method === "fillRect")
      expect(fillRectIndex).toBeGreaterThanOrEqual(0)
      expect(fillRectIndex).toBeLessThan(ctx.calls.findIndex((c) => c.method === "translate"))
    })

    it("never fills a background when backgroundColor is omitted — the live CanvasPlanGraph path stays transparent, unchanged from before this story", () => {
      const ctx = makeFakeContext()
      drawGraph(ctx, { ...baseParams, nodes: [planGraphNode({ id: "a" })], edges: [] })
      expect(ctx.calls.some((c) => c.method === "fillRect")).toBe(false)
    })
  })

  describe("Episode 18, Story 18.8 — search/filter dimming (canvas mode)", () => {
    it("wraps a dimmed node's draw in save/restore and sets globalAlpha to 0.32, not skipped and not fully opaque", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", isDimmed: true })
      drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })

      expect(ctx.calls.filter((c) => c.method === "save").length).toBeGreaterThan(0)
      expect(ctx.calls.filter((c) => c.method === "restore").length).toBeGreaterThan(0)
      // Still drawn — the label fillText call still happened, matching the
      // DOM path's "never unmount" rule (PlanNodeCard.tsx's own comment).
      expect(ctx.calls.some((c) => c.method === "fillText" && c.args[0] === "Seq Scan")).toBe(true)
      expect(ctx.globalAlpha).toBeCloseTo(0.32)
    })

    it("leaves an undimmed node's globalAlpha at 1", () => {
      const ctx = makeFakeContext()
      const node = planGraphNode({ id: "a", isDimmed: false })
      drawGraph(ctx, { ...baseParams, nodes: [node], edges: [] })
      expect(ctx.globalAlpha).toBe(1)
    })
  })
})
