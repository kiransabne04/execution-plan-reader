// Episode 15, Story 15.1 — the canvas path's actual drawing code. Pure
// functions over a CanvasRenderingContext2D (no React, no DOM query) so the
// visual-consistency checklist item ("same node size/color/edge-thickness
// conventions as the DOM/SVG path") is easy to audit: every value drawn
// here is read straight off the SAME PlanGraphNode/PlanGraphEdge data
// buildGraphElements.ts already produced for React Flow — no second
// encoding pass, no drift. See
// .claude/skills/canvas-rendering-performance/SKILL.md.

import type { PlanGraphEdge, PlanGraphNode } from "../buildGraphElements"
import type { ViewportTransform } from "./viewportTransform"

export interface DrawGraphParams {
  nodes: PlanGraphNode[]
  edges: PlanGraphEdge[]
  transform: ViewportTransform
  selectedNodeId?: string
  /** CSS pixels (not backing-store pixels — the caller has already scaled
   * the context for devicePixelRatio before calling this). */
  cssWidth: number
  cssHeight: number
  /** Resolved from a CSS custom property so canvas text/lines pick up the
   * viewer's actual theme (light/dark) rather than a hardcoded color —
   * see the artifact/theme convention this codebase otherwise follows via
   * CSS variables in every other stylesheet. */
  textColor: string
  selectionColor: string
  /** Episode 14, Story 14.2 — same `--pg-comparison-*` tokens PlanNodeCard
   * reads via CSS; resolved here instead since canvas has no cascade.
   * Undefined entries are fine (a plain single-plan render never passes
   * this at all) — see canvas-rendering-performance skill's "visual
   * consistency" checklist item this satisfies. */
  comparisonColors?: { changed: string; addedInB: string; removedFromB: string }
}

const SELECTED_OUTLINE_WIDTH = 3
const CORNER_RADIUS = 6
const MISMATCH_BADGE_TEXT = "est. mismatch"
const COMPARISON_BADGE_TEXT: Record<"changed" | "addedInB" | "removedFromB", string> = {
  changed: "changed",
  addedInB: "added",
  removedFromB: "removed",
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** Truncates `text` with an ellipsis so it fits `maxWidth`, matching the
 * DOM path's CSS text-overflow:ellipsis behavior — canvas has no built-in
 * equivalent, this has to be measured by hand. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}…`
}

function formatMeta(node: PlanGraphNode): string {
  if (node.data.kind !== "plan") return ""
  const planNode = node.data.planNode
  const rows = planNode.actualRows ?? planNode.estimatedRows
  const time = planNode.actualTimeMs
  const parts: string[] = []
  if (rows !== undefined) parts.push(`${rows.toLocaleString("en-US")} rows`)
  if (time !== undefined) parts.push(`${time.toFixed(1)}ms`)
  return parts.join(" · ")
}

function drawPlanNode(
  ctx: CanvasRenderingContext2D,
  node: PlanGraphNode,
  isSelected: boolean,
  textColor: string,
  selectionColor: string,
  comparisonColors: DrawGraphParams["comparisonColors"],
) {
  if (node.data.kind !== "plan") return
  const { x, y } = node.position
  const width = node.width ?? 160
  const height = node.height ?? 56
  const { color, hasMismatch, loopCount, planNode, comparisonOverlay } = node.data

  roundedRectPath(ctx, x, y, width, height, CORNER_RADIUS)
  ctx.fillStyle = colorWithAlpha(color, 0.18)
  ctx.fill()

  // Comparison-view border wins over the plain mismatch encoding when both
  // apply — same precedence PlanNodeCard's CSS uses (planGraph.css's
  // comment on the equivalent DOM rules explains why). A SOLID border keeps
  // it visually distinct from the mismatch encoding's dashed one.
  const comparisonStatus = comparisonOverlay?.status
  const comparisonColor =
    comparisonStatus && comparisonStatus !== "matched" && comparisonColors ? comparisonColors[comparisonStatus] : undefined

  if (comparisonColor) {
    ctx.setLineDash([])
    ctx.strokeStyle = comparisonColor
    ctx.lineWidth = 3
    ctx.stroke()
  } else {
    // Estimate-vs-actual mismatch: a DASHED border, never color alone —
    // same colorblind-safe rule the DOM/SVG path follows (graph-
    // visualization skill). Selection gets its own thicker solid outline
    // drawn after, so the two states stay visually distinct from each other.
    ctx.setLineDash(hasMismatch ? [6, 4] : [])
    ctx.strokeStyle = color
    ctx.lineWidth = hasMismatch ? 2 : 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (isSelected) {
    roundedRectPath(ctx, x - 2, y - 2, width + 4, height + 4, CORNER_RADIUS + 2)
    ctx.strokeStyle = selectionColor
    ctx.lineWidth = SELECTED_OUTLINE_WIDTH
    ctx.stroke()
  }

  const padding = 8
  ctx.fillStyle = textColor
  ctx.textBaseline = "top"
  ctx.font = "600 12px system-ui, sans-serif"
  ctx.fillText(fitText(ctx, planNode.rawOperatorLabel, width - padding * 2), x + padding, y + padding)

  const meta = formatMeta(node)
  if (meta) {
    ctx.font = "11px system-ui, sans-serif"
    ctx.globalAlpha = 0.75
    ctx.fillText(fitText(ctx, meta, width - padding * 2), x + padding, y + padding + 16)
    ctx.globalAlpha = 1
  }

  let badgeY = y + height - padding - 12
  if (loopCount !== undefined) {
    badgeY = drawBadge(ctx, `×${loopCount.toLocaleString("en-US")}`, x + padding, badgeY, textColor)
  }
  if (hasMismatch) {
    badgeY = drawBadge(ctx, MISMATCH_BADGE_TEXT, x + padding, badgeY, textColor)
  }
  if (comparisonStatus && comparisonStatus !== "matched") {
    drawBadge(ctx, COMPARISON_BADGE_TEXT[comparisonStatus], x + padding, badgeY, comparisonColor ?? textColor)
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, textColor: string): number {
  ctx.font = "10px system-ui, sans-serif"
  ctx.fillStyle = textColor
  ctx.globalAlpha = 0.65
  ctx.fillText(text, x, y)
  ctx.globalAlpha = 1
  return y - 14
}

function drawCollapsedGroupNode(ctx: CanvasRenderingContext2D, node: PlanGraphNode, textColor: string) {
  if (node.data.kind !== "collapsed-group") return
  const { x, y } = node.position
  const width = node.width ?? 160
  const height = node.height ?? 48

  roundedRectPath(ctx, x, y, width, height, CORNER_RADIUS)
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = textColor
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = textColor
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.font = "12px system-ui, sans-serif"
  ctx.fillText(`${node.data.hiddenNodeCount.toLocaleString("en-US")} hidden`, x + width / 2, y + height / 2)
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
}

function nodeAnchor(node: PlanGraphNode, side: "top" | "bottom"): { x: number; y: number } {
  const width = node.width ?? 160
  const height = node.height ?? 56
  return { x: node.position.x + width / 2, y: side === "top" ? node.position.y : node.position.y + height }
}

function drawEdges(ctx: CanvasRenderingContext2D, nodes: PlanGraphNode[], edges: PlanGraphEdge[], textColor: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue

    const from = nodeAnchor(source, "bottom")
    const to = nodeAnchor(target, "top")

    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    // A gentle vertical curve rather than a straight line — visually closer
    // to React Flow's default bezier edges than a rigid right-angle join.
    const midY = (from.y + to.y) / 2
    ctx.bezierCurveTo(from.x, midY, to.x, midY, to.x, to.y)
    ctx.strokeStyle = colorWithAlpha(textColor, 0.5)
    ctx.lineWidth = edge.data?.strokeWidth ?? 1.5
    ctx.setLineDash(edge.data?.isSharedReference ? [6, 4] : [])
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/** Canvas 2d has no `color-mix()` — this is the hand-rolled equivalent for
 * an hsl(...) or hex string, used everywhere this module wants a
 * translucent version of an already-computed encoding color. */
function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl(")) {
    return color.replace(/^hsl\(/, "hsla(").replace(/\)$/, `, ${alpha})`)
  }
  return color // already-opaque fallback colors (e.g. a resolved CSS variable) — used as-is
}

/** The one entry point the component calls per redraw. Draws in WORLD
 * coordinates — the caller must have already applied the DPR scale and the
 * pan/zoom transform to the context before calling this (kept separate so
 * this function stays a plain, testable "given a context and data, what
 * gets drawn" — no canvas-setup concerns baked in). */
export function drawGraph(ctx: CanvasRenderingContext2D, params: DrawGraphParams): void {
  const { nodes, edges, transform, selectedNodeId, cssWidth, cssHeight, textColor, selectionColor, comparisonColors } = params

  ctx.save()
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  drawEdges(ctx, nodes, edges, textColor)
  for (const node of nodes) {
    if (node.data.kind === "plan") {
      drawPlanNode(ctx, node, node.id === selectedNodeId, textColor, selectionColor, comparisonColors)
    } else {
      drawCollapsedGroupNode(ctx, node, textColor)
    }
  }

  ctx.restore()
}
