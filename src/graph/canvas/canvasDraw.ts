// Episode 15, Story 15.1 — the canvas path's actual drawing code. Pure
// functions over a CanvasRenderingContext2D (no React, no DOM query) so the
// visual-consistency checklist item ("same node size/color/edge-thickness
// conventions as the DOM/SVG path") is easy to audit: every value drawn
// here is read straight off the SAME PlanGraphNode/PlanGraphEdge data
// buildGraphElements.ts already produced for React Flow — no second
// encoding pass, no drift. See
// .claude/skills/canvas-rendering-performance/SKILL.md.
//
// Episode 18, Story 18.4 — icons specifically are the one place this file
// deliberately does NOT match the DOM path pixel-for-pixel: PlanNodeCard.tsx
// renders real Phosphor React SVG components, which can't be drawn into a
// raw 2D canvas context without first rasterizing them (loading each as an
// offscreen image) — real complexity not warranted for a fallback glyph.
// Single bold-letter glyphs stand in instead, keeping the per-operator-type
// MAPPING identical even though the linework differs — see ICON_GLYPH
// below. Note there is NO legible-zoom-floor text degrade anywhere in this
// file yet (label/meta text is drawn unconditionally at every zoom level
// today, same as before this story) — icon/subtitle simply follow that
// same existing behavior. A "degrade to solid heat blocks below a zoom
// floor" treatment is Episode 18 Story 18.10's job, not introduced here.

import type { PlanGraphEdge, PlanGraphNode } from "../buildGraphElements"
import { computeHandleOffsetPercent } from "../buildGraphElements"
import type { OperatorIconKey } from "../operatorIcons"
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
  /** Story 18.4, spec §4's "two stroke colours only." Resolved from
   * `--color-edge-hot`/`--color-edge-muted` by the caller, same pattern as
   * every other color here. */
  edgeColors: { hot: string; muted: string }
  /** Story 18.4, spec §3's severity ring. `--color-critical`/`--color-warning`. */
  severityColors: { critical: string; warning: string }
}

const SELECTED_OUTLINE_WIDTH = 3
const CORNER_RADIUS = 6
const MISMATCH_BADGE_TEXT = "est. mismatch"
const COMPARISON_BADGE_TEXT: Record<"changed" | "addedInB" | "removedFromB", string> = {
  changed: "changed",
  addedInB: "added",
  removedFromB: "removed",
}

/** Story 18.4 — see this file's own module comment on why these stand in
 * for the DOM path's real Phosphor icons. `ƒ` and `#` are the same
 * mnemonic characters the real Function/Hash icons use; the rest are
 * single-letter initials chosen for clarity, not a font-availability risk
 * the way an obscure Unicode symbol (a real magnifying-glass glyph, etc.)
 * would be — every character here is plain ASCII/Latin-1. */
const ICON_GLYPH: Record<OperatorIconKey, string> = {
  limit: "↓",
  aggregate: "ƒ",
  sort: "S",
  join: "J",
  scan: "T",
  hash: "#",
  index: "I",
  unknown: "○",
}

const ARROWHEAD_SIZE_PX = 11
const TARGET_HANDLE_GAP_PX = 10

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
  severityColors: DrawGraphParams["severityColors"],
) {
  if (node.data.kind !== "plan") return
  const { x, y } = node.position
  const width = node.width ?? 160
  const height = node.height ?? 56
  const { color, hasMismatch, loopCount, planNode, comparisonOverlay, severity, iconKey, subtitle, isDimmed } = node.data

  // Story 18.8, spec §5 `1h` — canvas-mode equivalent of PlanNodeCard's
  // opacity dimming: globalAlpha applies to every fill/stroke below (the
  // whole node stays drawn, never skipped, matching the DOM path's "never
  // unmount" rule), restored at the end so sibling nodes aren't affected.
  ctx.save()
  const dimAlpha = isDimmed ? 0.32 : 1
  ctx.globalAlpha = dimAlpha

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

  // Story 18.4, spec §3 — severity ring: a second, larger rounded-rect
  // stroke OUTSIDE the border, standing in for the DOM path's box-shadow
  // (canvas has no box-shadow equivalent). Always paired with the
  // severity badge below — never colour alone.
  const severityColor = severity === "critical" ? severityColors.critical : severity === "warning" ? severityColors.warning : undefined
  if (severityColor) {
    const ringWidth = severity === "critical" ? 3 : 2
    roundedRectPath(ctx, x - ringWidth, y - ringWidth, width + ringWidth * 2, height + ringWidth * 2, CORNER_RADIUS + ringWidth)
    ctx.strokeStyle = severityColor
    ctx.lineWidth = ringWidth
    ctx.stroke()
  }

  if (isSelected) {
    roundedRectPath(ctx, x - 2, y - 2, width + 4, height + 4, CORNER_RADIUS + 2)
    ctx.strokeStyle = selectionColor
    ctx.lineWidth = SELECTED_OUTLINE_WIDTH
    ctx.stroke()
  }

  const padding = 8
  const iconSize = 12
  ctx.textBaseline = "top"

  // Story 18.4 — icon glyph, then the label beside it (matching the DOM
  // path's icon-before-label layout).
  ctx.font = `600 ${iconSize}px system-ui, sans-serif`
  ctx.fillStyle = colorWithAlpha(textColor, 0.75)
  ctx.fillText(ICON_GLYPH[iconKey], x + padding, y + padding)
  const iconWidth = ctx.measureText(ICON_GLYPH[iconKey]).width

  ctx.font = "600 12px system-ui, sans-serif"
  ctx.fillStyle = textColor
  const labelX = x + padding + iconWidth + 5
  ctx.fillText(fitText(ctx, planNode.rawOperatorLabel, width - padding * 2 - iconWidth - 5), labelX, y + padding)

  let nextLineY = y + padding + 16
  if (subtitle) {
    ctx.font = "10.5px ui-monospace, Menlo, monospace"
    ctx.fillStyle = colorWithAlpha(textColor, 0.75)
    ctx.fillText(fitText(ctx, subtitle, width - padding * 2), x + padding, nextLineY)
    nextLineY += 13
  }

  const meta = formatMeta(node)
  if (meta) {
    ctx.font = "11px system-ui, sans-serif"
    ctx.fillStyle = colorWithAlpha(textColor, 0.75)
    ctx.fillText(fitText(ctx, meta, width - padding * 2), x + padding, nextLineY)
  }

  let badgeY = y + height - padding - 12
  if (loopCount !== undefined) {
    badgeY = drawBadge(ctx, `×${loopCount.toLocaleString("en-US")}`, x + padding, badgeY, textColor, dimAlpha)
  }
  if (hasMismatch) {
    badgeY = drawBadge(ctx, MISMATCH_BADGE_TEXT, x + padding, badgeY, textColor, dimAlpha)
  }
  if (severity && severityColor) {
    badgeY = drawBadge(ctx, severity, x + padding, badgeY, severityColor, dimAlpha)
  }
  if (comparisonStatus && comparisonStatus !== "matched") {
    drawBadge(ctx, COMPARISON_BADGE_TEXT[comparisonStatus], x + padding, badgeY, comparisonColor ?? textColor, dimAlpha)
  }
  ctx.restore()
}

/** `dimAlpha` composes with the badge's own 0.65 translucency rather than
 * clobbering it — a hardcoded reset to 1 here would fight the dimmed node's
 * globalAlpha set by the caller (canvas globalAlpha is absolute, not a
 * stack that multiplies automatically the way nested opacity would in CSS). */
function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, textColor: string, dimAlpha: number): number {
  ctx.font = "10px system-ui, sans-serif"
  ctx.fillStyle = textColor
  ctx.globalAlpha = 0.65 * dimAlpha
  ctx.fillText(text, x, y)
  ctx.globalAlpha = dimAlpha
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

/**
 * Story 18.4 — `source` (this node's own outgoing edge, to its parent)
 * anchors at this node's TOP-center; `target` (an incoming edge, from one
 * of this node's children) anchors at this node's BOTTOM edge, offset by
 * `computeHandleOffsetPercent` — the exact same math PlanNodeCard.tsx uses
 * for its Handle `left` positions, so the DOM/SVG and canvas paths never
 * visually disagree about where an edge lands. `childCount` is read off
 * the TARGET node's own data (already computed once in
 * buildGraphElements.ts), not re-derived here.
 */
function edgeAnchor(node: PlanGraphNode, side: "source" | "target", targetChildIndex: number): { x: number; y: number } {
  const width = node.width ?? 160
  const height = node.height ?? 56
  if (side === "source") {
    return { x: node.position.x + width / 2, y: node.position.y }
  }
  const childCount = node.data.kind === "plan" ? node.data.childCount : 1
  const offsetPercent = computeHandleOffsetPercent(targetChildIndex, childCount)
  return { x: node.position.x + (width * offsetPercent) / 100, y: node.position.y + height + TARGET_HANDLE_GAP_PX }
}

/** A fixed-size (never scaling with stroke width — spec §4) triangle
 * pointing straight up, matching the curve's actual approach direction at
 * its endpoint (the bezier's second control point always shares the
 * endpoint's x, so the final approach is always vertical regardless of
 * how much the curve bent to get there). */
function drawArrowhead(ctx: CanvasRenderingContext2D, tip: { x: number; y: number }, color: string) {
  const halfWidth = ARROWHEAD_SIZE_PX / 2.5
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - halfWidth, tip.y + ARROWHEAD_SIZE_PX)
  ctx.lineTo(tip.x + halfWidth, tip.y + ARROWHEAD_SIZE_PX)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  nodes: PlanGraphNode[],
  edges: PlanGraphEdge[],
  edgeColors: DrawGraphParams["edgeColors"],
) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue

    const targetChildIndex = edge.data?.targetChildIndex ?? 0
    const from = edgeAnchor(source, "source", targetChildIndex)
    const to = edgeAnchor(target, "target", targetChildIndex)
    const strokeColor = edge.data?.isHotPath ? edgeColors.hot : edgeColors.muted

    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    // A gentle vertical curve rather than a straight line — visually closer
    // to React Flow's smoothstep edges than a rigid right-angle join, while
    // staying cheap to compute per redraw.
    const midY = (from.y + to.y) / 2
    ctx.bezierCurveTo(from.x, midY, to.x, midY, to.x, to.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = edge.data?.strokeWidth ?? 1.5
    ctx.setLineDash(edge.data?.isSharedReference ? [6, 4] : [])
    ctx.stroke()
    ctx.setLineDash([])

    drawArrowhead(ctx, to, strokeColor)
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
  const { nodes, edges, transform, selectedNodeId, cssWidth, cssHeight, textColor, selectionColor, comparisonColors, edgeColors, severityColors } =
    params

  ctx.save()
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  drawEdges(ctx, nodes, edges, edgeColors)
  for (const node of nodes) {
    if (node.data.kind === "plan") {
      drawPlanNode(ctx, node, node.id === selectedNodeId, textColor, selectionColor, comparisonColors, severityColors)
    } else {
      drawCollapsedGroupNode(ctx, node, textColor)
    }
  }

  ctx.restore()
}
