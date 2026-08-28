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
      { id: "a->b", source: "a", target: "b", data: { rows: 100, strokeWidth: 2, isSharedReference: false } },
      { id: "a->missing", source: "a", target: "does-not-exist", data: { rows: 0, strokeWidth: 1, isSharedReference: false } },
    ]
    const ctx = makeFakeContext()
    expect(() => drawGraph(ctx, { ...baseParams, nodes: [a, b], edges })).not.toThrow()
    expect(ctx.calls.some((c) => c.method === "bezierCurveTo")).toBe(true)
  })

  it("uses a dashed line for a shared-reference edge", () => {
    const a = planGraphNode({ id: "a", x: 0, y: 0 })
    const b = planGraphNode({ id: "b", x: 0, y: 200 })
    const edges: PlanGraphEdge[] = [
      { id: "a->b", source: "a", target: "b", data: { rows: 100, strokeWidth: 2, isSharedReference: true } },
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
})
