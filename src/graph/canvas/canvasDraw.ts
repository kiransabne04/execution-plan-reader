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
// below.
//
// Episode 18, Story 18.10 — LEGIBLE_ZOOM_FLOOR: below it, `drawPlanNode`
// skips ALL text (icon/label/subtitle/meta/badges), keeping only the
// card's own fill/border/ring/selection outline — never illegibly-small
// text. `drawCollapsedGroupNode`'s "N hidden" label follows the same rule.
//
// Episode 26, Story 26.7 — a mockup-driven restyle pass
// (docs/08-episodes-and-stories.md) replaced the per-node metric-color
// heatmap fill/border this file used to draw with flat, neutral node
// cards (`nodeSurfaceColor`/`nodeBorderColor`/`nodeAccentColor` below) —
// matching the reference mockup pixel-for-pixel. Severity/mismatch stay
// exactly as speced: a distinct ring/dashed border and badge text, never
// color alone. See encoding.ts's own Story 26.7 comment for why the
// underlying metric-color function was removed rather than just unused.

import type { ComparisonOverlay, PlanGraphEdge, PlanGraphNode } from "../buildGraphElements"
import { computeHandleOffsetPercent } from "../buildGraphElements"
import type { OperatorIconKey } from "../operatorIcons"
import type { PlanNode } from "../../parsers/normalize"
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
  /** Episode 26, Story 26.7 — the node card's own flat, neutral chrome,
   * matching the reference mockup exactly: `nodeSurfaceColor` (the card's
   * solid fill, `--color-surface`/`--pg-card-bg`), `nodeBorderColor` (the
   * card's rest-state border, `--color-border-strong` — NOT the fainter
   * `--pg-card-border`/`--color-border` used elsewhere for chrome
   * dividers), and `nodeAccentColor` (the hovered-card border,
   * `--color-accent`, matching the mockup's own `.node:hover{border-
   * color:accent}`). Replaces the old per-node metric-color heatmap fill —
   * see this file's own module comment. */
  nodeSurfaceColor: string
  nodeBorderColor: string
  nodeAccentColor: string
  /** Neutral pill background for the loop-count/mismatch/spill badges,
   * which carry no severity/comparison color of their own — resolved from
   * `--color-border` (already a translucent overlay tint, not a solid
   * color), matching the mockup's own `.node .flag` chip treatment
   * generalized to every badge kind it doesn't give an explicit example
   * of. */
  badgeNeutralBg: string
  /** Episode 26, Story 26.7 — the currently-hovered node (from
   * `CanvasPlanGraph`'s own tooltip-tracking state, reused rather than a
   * second hover-tracking mechanism), so its border can pick up
   * `nodeAccentColor` the same way a real `:hover` CSS rule would for the
   * DOM path this canvas mode replaced. Optional — omitted entirely
   * outside a live pointer-driven render (e.g. PNG export). */
  hoveredNodeId?: string
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
  /** Story 18.11 — PNG export's own opaque page background (the live
   * on-screen canvas is transparent over its already-styled `.plan-graph`
   * container's CSS background, but an exported PNG has no such container
   * once saved/shared elsewhere, so export explicitly fills one). Omitted
   * (the live CanvasPlanGraph path) means "leave transparent," unchanged
   * from every version of this function before this story. */
  backgroundColor?: string
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

// Design review (reference mock) — the top-right "N%" figure only appears
// on the handful of nodes actually worth calling out at a glance; every
// node showing it unconditionally would be noise. A judgment call, not a
// value read off any spec — 20% draws the line at "a clearly dominant
// contributor" without pretending false precision. Episode 26, Story 26.1:
// this constant and its drawing both used to live in the now-deleted
// PlanNodeCard.tsx (DOM/SVG mode) — this is the single implementation now,
// not a second one re-derived here.
const CONTRIBUTION_BADGE_THRESHOLD = 20

// Story 18.10, spec §5 `1i` — the canvas path's own legible-zoom floor
// (independent of the DOM/SVG path's MIN_LEGIBLE_ZOOM in PlanGraph.tsx,
// which floors React Flow's own zoom prop; canvas mode has no such prop —
// this floor instead gates what `drawPlanNode` draws at the CURRENT
// `transform.scale`). Text is drawn at `LABEL_FONT_WORLD_PX` in world
// units, then scaled by `ctx.scale(transform.scale, ...)` in `drawGraph`
// — so its actual on-screen size is `LABEL_FONT_WORLD_PX * transform.scale`.
// Below `MIN_LEGIBLE_FONT_SCREEN_PX` on screen, text stops being
// information and becomes sub-pixel noise — the floor is derived from
// that ratio, not an arbitrary guess.
const LABEL_FONT_WORLD_PX = 12
const MIN_LEGIBLE_FONT_SCREEN_PX = 8
const LEGIBLE_ZOOM_FLOOR = MIN_LEGIBLE_FONT_SCREEN_PX / LABEL_FONT_WORLD_PX

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

/** "Seq Scan -> Index Scan", plus a cost or time delta line when both sides
 * report a comparable figure — never a fabricated delta when one side is
 * missing the field (e.g. Snowflake's actualTimeMs, which is intentionally
 * left undefined; see normalize.ts's TimeBreakdownInfo comment). Episode
 * 26, Story 26.1: ported verbatim from the now-deleted PlanNodeCard.tsx —
 * this is the single implementation now, not a second one re-derived here. */
function formatComparisonDelta(planNode: PlanNode, counterpart: NonNullable<ComparisonOverlay["counterpart"]>): string {
  const operatorDelta = `${planNode.rawOperatorLabel} → ${counterpart.rawOperatorLabel}`
  const metricDelta = formatMetricDelta(planNode.estimatedCost, counterpart.estimatedCost, "cost") ?? formatMetricDelta(planNode.actualTimeMs, counterpart.actualTimeMs, "time")
  return metricDelta ? `${operatorDelta} (${metricDelta})` : operatorDelta
}

function formatMetricDelta(before: number | undefined, after: number | undefined, label: string): string | undefined {
  if (before === undefined || after === undefined || before <= 0) return undefined
  const percentChange = Math.round(((after - before) / before) * 100)
  if (percentChange === 0) return undefined
  const direction = percentChange < 0 ? "↓" : "↑"
  return `${label} ${direction}${Math.abs(percentChange)}%`
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
  isHovered: boolean,
  textColor: string,
  selectionColor: string,
  nodeSurfaceColor: string,
  nodeBorderColor: string,
  nodeAccentColor: string,
  badgeNeutralBg: string,
  comparisonColors: DrawGraphParams["comparisonColors"],
  severityColors: DrawGraphParams["severityColors"],
  belowLegibleFloor: boolean,
) {
  if (node.data.kind !== "plan") return
  const { x, y } = node.position
  const width = node.width ?? 160
  const height = node.height ?? 56
  const {
    hasMismatch,
    mismatchFactor,
    spillBadgeText,
    loopCount,
    planNode,
    comparisonOverlay,
    severity,
    iconKey,
    subtitle,
    isDimmed,
    contributionPercent,
  } = node.data

  // Story 18.8, spec §5 `1h` — canvas-mode equivalent of PlanNodeCard's
  // opacity dimming: globalAlpha applies to every fill/stroke below (the
  // whole node stays drawn, never skipped, matching the DOM path's "never
  // unmount" rule), restored at the end so sibling nodes aren't affected.
  ctx.save()
  const dimAlpha = isDimmed ? 0.32 : 1
  ctx.globalAlpha = dimAlpha

  roundedRectPath(ctx, x, y, width, height, CORNER_RADIUS)
  // Episode 26, Story 26.7 — a flat, solid neutral fill at every zoom
  // level (matching the reference mockup's own uniform card background)
  // rather than the old per-node metric-color tint. The legible-zoom
  // floor no longer needs a separate "solid heat block" branch — the fill
  // was already solid and already the one signal that survives to that
  // zoom, it's just neutral now instead of heat-colored.
  ctx.fillStyle = nodeSurfaceColor
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
    // visualization skill); the dash pattern alone carries that signal,
    // so the border color itself stays the same neutral/hover treatment
    // every other card gets. Selection gets its own thicker solid outline
    // drawn after, so the two states stay visually distinct from each other.
    ctx.setLineDash(hasMismatch ? [6, 4] : [])
    ctx.strokeStyle = isHovered ? nodeAccentColor : nodeBorderColor
    ctx.lineWidth = hasMismatch ? 2 : 1
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

  // Story 18.10 — below the legible-zoom floor, none of the text below is
  // drawn at all (icon glyph, label, subtitle, meta, badges): at this
  // scale it would render as illegible sub-pixel noise, not information —
  // spec §5 `1i`'s "solid heat-colored blocks with no text," not
  // illegibly-small text. The color/border/ring/selection signals above
  // still draw regardless — those stay meaningful at any zoom.
  if (belowLegibleFloor) {
    ctx.restore()
    return
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
  const labelMaxWidth = width - padding * 2 - iconWidth - 5 - (contributionPercent !== undefined && contributionPercent >= CONTRIBUTION_BADGE_THRESHOLD ? 28 : 0)
  ctx.fillText(fitText(ctx, planNode.rawOperatorLabel, labelMaxWidth), labelX, y + padding)

  // Design review — the top-right "N%" figure (see this file's own
  // `CONTRIBUTION_BADGE_THRESHOLD` comment). Plain muted text, matching
  // the DOM path's treatment — a measurement, not a finding, so it doesn't
  // compete visually with the badges drawn below. Right-aligned against
  // the card's own right edge, same row as the label.
  if (contributionPercent !== undefined && contributionPercent >= CONTRIBUTION_BADGE_THRESHOLD) {
    ctx.font = "11px system-ui, sans-serif"
    ctx.fillStyle = colorWithAlpha(textColor, 0.75)
    ctx.textAlign = "right"
    ctx.fillText(`${Math.round(contributionPercent)}%`, x + width - padding, y + padding)
    ctx.textAlign = "left"
  }

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
    nextLineY += 13
  }

  // Story 14.2's AC: a changed node shows "the specific delta ... e.g.
  // Seq Scan -> Index Scan, cost/time delta" directly, not tucked behind a
  // click — matching the DOM path's own visible, un-clicked placement.
  if (comparisonOverlay?.status === "changed" && comparisonOverlay.counterpart) {
    ctx.font = "600 11px system-ui, sans-serif"
    ctx.fillStyle = textColor
    ctx.fillText(fitText(ctx, formatComparisonDelta(planNode, comparisonOverlay.counterpart), width - padding * 2), x + padding, nextLineY)
  }

  // Episode 26, Story 26.7 — badges bottom-up as before, but each is now a
  // rounded, tinted PILL (matching the reference mockup's own `.node
  // .flag` chip), not plain stacked text — `bottomY` tracks the bottom
  // edge of the NEXT pill to place, working upward from the card's own
  // bottom padding.
  let bottomY = y + height - padding
  if (loopCount !== undefined) {
    bottomY = drawBadge(ctx, `×${loopCount.toLocaleString("en-US")}`, x + padding, bottomY, textColor, badgeNeutralBg, dimAlpha)
  }
  if (hasMismatch) {
    const mismatchText = mismatchFactor !== undefined ? `${MISMATCH_BADGE_TEXT} ${mismatchFactor}×` : MISMATCH_BADGE_TEXT
    bottomY = drawBadge(ctx, mismatchText, x + padding, bottomY, textColor, badgeNeutralBg, dimAlpha)
  }
  if (severity && severityColor) {
    bottomY = drawBadge(ctx, severity, x + padding, bottomY, severityColor, colorWithAlpha(severityColor, 0.16), dimAlpha)
  }
  if (spillBadgeText) {
    bottomY = drawBadge(ctx, spillBadgeText, x + padding, bottomY, textColor, badgeNeutralBg, dimAlpha)
  }
  if (comparisonStatus && comparisonStatus !== "matched") {
    const bg = comparisonColor ? colorWithAlpha(comparisonColor, 0.16) : badgeNeutralBg
    drawBadge(ctx, COMPARISON_BADGE_TEXT[comparisonStatus], x + padding, bottomY, comparisonColor ?? textColor, bg, dimAlpha)
  }
  ctx.restore()
}

/** Draws one rounded, tinted pill (mockup's own `.node .flag` chip
 * language) and returns the bottom-y for the NEXT pill above it. `dimAlpha`
 * composes with the pill's own fill/text rather than clobbering it — a
 * hardcoded reset to 1 here would fight the dimmed node's globalAlpha set
 * by the caller (canvas globalAlpha is absolute, not a stack that
 * multiplies automatically the way nested opacity would in CSS). */
function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, bottomY: number, textColor: string, bgColor: string, dimAlpha: number): number {
  const paddingX = 6
  const badgeHeight = 15
  ctx.font = "10px system-ui, sans-serif"
  const textWidth = ctx.measureText(text).width
  const badgeWidth = textWidth + paddingX * 2
  const topY = bottomY - badgeHeight

  ctx.globalAlpha = dimAlpha
  roundedRectPath(ctx, x, topY, badgeWidth, badgeHeight, 5)
  ctx.fillStyle = bgColor
  ctx.fill()

  ctx.fillStyle = textColor
  ctx.fillText(text, x + paddingX, topY + 3)
  ctx.globalAlpha = dimAlpha

  return topY - 3
}

function drawCollapsedGroupNode(ctx: CanvasRenderingContext2D, node: PlanGraphNode, textColor: string, belowLegibleFloor: boolean) {
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

  // Story 18.10 — same legible-zoom-floor rule drawPlanNode follows: its
  // "N hidden" text is just as illegible at this scale, so it's skipped
  // the same way, leaving the dashed outline (still a real, visible
  // signal — "something's collapsed here") without unreadable text noise.
  if (belowLegibleFloor) return

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
 * an hsl(...) or `#rrggbb` hex string, used everywhere this module wants a
 * translucent version of an already-computed encoding color (severity/
 * comparison badge pill backgrounds — Story 26.7). */
function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("hsl(")) {
    return color.replace(/^hsl\(/, "hsla(").replace(/\)$/, `, ${alpha})`)
  }
  const hexMatch = /^#([0-9a-fA-F]{6})$/.exec(color)
  if (hexMatch) {
    const r = Number.parseInt(hexMatch[1].slice(0, 2), 16)
    const g = Number.parseInt(hexMatch[1].slice(2, 4), 16)
    const b = Number.parseInt(hexMatch[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color // already-translucent/other resolved CSS values (e.g. an rgba() custom property) — used as-is
}

/** The one entry point the component calls per redraw. Draws in WORLD
 * coordinates — the caller must have already applied the DPR scale and the
 * pan/zoom transform to the context before calling this (kept separate so
 * this function stays a plain, testable "given a context and data, what
 * gets drawn" — no canvas-setup concerns baked in). */
export function drawGraph(ctx: CanvasRenderingContext2D, params: DrawGraphParams): void {
  const {
    nodes,
    edges,
    transform,
    selectedNodeId,
    hoveredNodeId,
    cssWidth,
    cssHeight,
    textColor,
    selectionColor,
    nodeSurfaceColor,
    nodeBorderColor,
    nodeAccentColor,
    badgeNeutralBg,
    comparisonColors,
    edgeColors,
    severityColors,
    backgroundColor,
  } = params

  ctx.save()
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  // Story 18.11 — filled BEFORE translate/scale (in plain device-pixel
  // space, covering the whole canvas) so it's unaffected by the pan/zoom
  // transform applied to everything drawn after it.
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, cssWidth, cssHeight)
  }
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  const belowLegibleFloor = transform.scale < LEGIBLE_ZOOM_FLOOR

  drawEdges(ctx, nodes, edges, edgeColors)
  for (const node of nodes) {
    if (node.data.kind === "plan") {
      drawPlanNode(
        ctx,
        node,
        node.id === selectedNodeId,
        node.id === hoveredNodeId,
        textColor,
        selectionColor,
        nodeSurfaceColor,
        nodeBorderColor,
        nodeAccentColor,
        badgeNeutralBg,
        comparisonColors,
        severityColors,
        belowLegibleFloor,
      )
    } else {
      drawCollapsedGroupNode(ctx, node, textColor, belowLegibleFloor)
    }
  }

  ctx.restore()
}
