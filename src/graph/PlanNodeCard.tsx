import type { KeyboardEvent, MouseEvent } from "react"
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import { computeHandleOffsetPercent, targetHandleId, type ComparisonOverlay, type PlanNodeData } from "./buildGraphElements"
import { OPERATOR_ICON_COMPONENT } from "./operatorIcons"
import { buildNodeTooltip } from "./nodeTooltip"

type PlanNodeCardProps = NodeProps<Node<PlanNodeData, "planNode">>

// Episode 14, Story 14.2: "matched" is deliberately absent here — a matched,
// unchanged node keeps the card's normal neutral styling (the AC's own
// wording), not a fourth highlight color competing for attention with the
// three states that actually differ from baseline.
const COMPARISON_BADGE_TEXT: Record<Exclude<ComparisonOverlay["status"], "matched">, string> = {
  changed: "changed",
  addedInB: "added",
  removedFromB: "removed",
}
const COMPARISON_MODIFIER_CLASS: Record<Exclude<ComparisonOverlay["status"], "matched">, string> = {
  changed: "plan-node-card--comparison-changed",
  addedInB: "plan-node-card--comparison-added",
  removedFromB: "plan-node-card--comparison-removed",
}

// Story 18.4, spec §3: "Severity ring | Warning.severity | 2px amber / 3px
// red box-shadow + faint glow." Info-severity warnings get no ring — the
// ring is reserved for the two levels spec names explicitly.
const SEVERITY_RING_CLASS: Partial<Record<PlanNodeData["severity"] & string, string>> = {
  critical: "plan-node-card--severity-critical",
  warning: "plan-node-card--severity-warning",
}

// Design review (downloaded main-canvas mockup): the mismatch/spill badges
// are severity-tinted there, matching whatever this node's OWN worst
// severity is (the same value the ring above is keyed on) rather than a
// fixed color per badge type — a node whose mismatch is only info-tier (no
// ring shown either) gets the plain neutral badge, same as the ring's own
// "info gets nothing extra" rule.
const SEVERITY_BADGE_CLASS: Partial<Record<PlanNodeData["severity"] & string, string>> = {
  critical: "plan-node-card__badge--critical",
  warning: "plan-node-card__badge--warning",
}

// Story 18.4, spec §4: edges stop 10px short of the parent's border so an
// arrival reads as an arrival, not an overlap — applied at the TARGET end
// (this node, receiving edges from its children on its bottom edge).
const TARGET_HANDLE_GAP_PX = 10

// Design review (reference mock) — the top-right "N%" figure only appears
// on the handful of nodes actually worth calling out at a glance; every
// node showing it unconditionally would be noise (and doesn't match any
// example in the mock, where most cards carry no percentage at all). This
// is a judgment call, not a value read off any spec — 20% draws the line
// at "a clearly dominant contributor" without pretending false precision.
const CONTRIBUTION_BADGE_THRESHOLD = 20

export function PlanNodeCard({ data }: PlanNodeCardProps) {
  const {
    planNode,
    width,
    color,
    hasMismatch,
    mismatchFactor,
    spillBadgeText,
    loopCount,
    comparisonOverlay,
    severity,
    iconKey,
    subtitle,
    contributionPercent,
    childCount,
    isDimmed,
    onOpen,
  } = data
  const classNames = ["plan-node-card"]
  if (hasMismatch) classNames.push("plan-node-card--mismatch")
  if (comparisonOverlay && comparisonOverlay.status !== "matched") {
    classNames.push(COMPARISON_MODIFIER_CLASS[comparisonOverlay.status])
  }
  // Design review (reference mock): the earlier "never colour alone" rule
  // paired every severity ring with a plain-word "critical"/"warning"
  // badge; every example in the mock instead relies on the ring/glow ALONE
  // whenever no more specific badge (mismatch factor, spill size, loop
  // count) already names the finding — that generic word badge never
  // appears anywhere in it. Severity is never conveyed by colour alone at
  // the APP level regardless (the always-visible Findings list states
  // every warning in text, and the detail panel repeats it in prose on
  // click) — this only drops a redundant repetition on the card itself.
  const severityRingClass = severity ? SEVERITY_RING_CLASS[severity] : undefined
  if (severityRingClass) classNames.push(severityRingClass)
  const className = classNames.join(" ")
  const severityBadgeClass = severity ? SEVERITY_BADGE_CLASS[severity] : undefined
  const badgeClassName = (extra?: string) => ["plan-node-card__badge", severityBadgeClass, extra].filter(Boolean).join(" ")
  // Hover tooltip (graph-visualization skill: hover tooltip and click detail
  // panel are two separate components) — CSS-only reveal (:hover/:focus-
  // within in planGraph.css), no extra state or render cost per card, and
  // the same content stays reachable via keyboard focus, not mouse-only.
  const tooltip = buildNodeTooltip(planNode)
  const Icon = OPERATOR_ICON_COMPONENT[iconKey]

  // Keyboard access (Story 6.2's accessibility acceptance criterion):
  // Enter/Space on a focused card opens the same detail panel a click
  // would. A mouse click is already handled by ReactFlow's own
  // onNodeClick at the container level; this covers the keyboard path
  // that wouldn't otherwise fall out of that for free.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen?.()
    }
  }

  // Explicit rather than relying on a mouse click implicitly moving focus
  // to a non-native tabindex element — real browsers mostly do this, but
  // it shouldn't be left ambient, since the detail panel restores focus to
  // "whatever was focused when it opened" and that needs to reliably be
  // this card, not whatever was focused before the click.
  // Story 20.2: `{ preventScroll: true }` — a bare `.focus()`'s default
  // scrollIntoView walks up every scrollable ancestor including the outer
  // page, so clicking a card already fully visible inside the graph pane
  // could still yank the whole shell's scroll position. The card is
  // already on-screen (it was just clicked); focus should land without
  // moving anything.
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true })
  }

  return (
    // Outer wrapper (no overflow clipping, unlike .plan-node-card itself,
    // which needs overflow:hidden for its label/meta text-overflow ellipsis)
    // — the tooltip is this wrapper's sibling-of-the-card, not its child, so
    // it can render outside the small card's bounds instead of being clipped.
    <div
      className="plan-node-card-wrapper"
      // Story 18.8, spec §5 `1h`: dimmed via opacity, never unmounted —
      // the DOM node count (and this component's own subtree) stays
      // exactly the same whether or not a search is active, so the plan's
      // overall shape never disappears mid-search.
      style={{ opacity: isDimmed ? 0.32 : 1, transition: "opacity 0.1s ease" }}
      data-dimmed={isDimmed || undefined}
    >
      <div
        className={className}
        style={{
          // undefined here lets the mismatch/comparison/severity CSS
          // class's own border-color win instead of this inline metric-
          // encoded color — an inline style always beats a class on
          // specificity, so this is the one place that distinction
          // actually has to be made explicit.
          borderColor: hasMismatch || (comparisonOverlay && comparisonOverlay.status !== "matched") ? undefined : color,
          background: `color-mix(in srgb, ${color} 18%, var(--pg-card-bg))`,
          // Design review (spec §2 "2a fluid shell"): "Node cards use
          // min(px, %) widths so the row-count encoding survives a narrow
          // canvas." `width` here is this node's own row-count-encoded
          // pixel size (encoding.ts's `sizeFor`) — normally that's exactly
          // what renders (the React Flow wrapper is already sized to it),
          // but on a canvas narrower than the encoding calls for, `40cqi`
          // (of `.plan-shell__graph`, the canvas pane itself —
          // container-type: inline-size, planGraph.css) caps the VISIBLE
          // card below its reserved slot rather than letting it overflow.
          // Handles are positioned as a percentage of this same element
          // (computeHandleOffsetPercent below), so edges still land
          // correctly on the smaller rendered size, not the original slot.
          width: width !== undefined ? `min(${width}px, 40cqi)` : undefined,
        }}
        title={planNode.rawOperatorLabel}
        data-testid="plan-node-card"
        data-node-id={planNode.id}
        tabIndex={0}
        role="button"
        aria-label={`${planNode.rawOperatorLabel} — open details`}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        {/* Story 18.4: handles swap — `source` (this node's OWN outgoing
            edge, to ITS parent) on Top, `target` (incoming edges, from
            THIS node's children) on Bottom — see buildGraphElements.ts's
            module comment for why. One source handle (every node has at
            most one parent); `childCount` target handles, spread across
            the bottom edge via the exact same offset math
            canvasDraw.ts uses, so the DOM/SVG and canvas paths never
            visually disagree about where an edge lands. */}
        <Handle type="source" position={Position.Top} id="source" />
        {Array.from({ length: childCount }, (_, i) => (
          <Handle
            key={targetHandleId(i)}
            id={targetHandleId(i)}
            type="target"
            position={Position.Bottom}
            style={{ left: `${computeHandleOffsetPercent(i, childCount)}%`, bottom: -TARGET_HANDLE_GAP_PX }}
          />
        ))}
        <div className="plan-node-card__label">
          <span className="plan-node-card__label-main">
            {Icon && <Icon className="plan-node-card__icon" weight="regular" aria-hidden="true" />}
            <span>{planNode.rawOperatorLabel}</span>
          </span>
          {contributionPercent !== undefined && contributionPercent >= CONTRIBUTION_BADGE_THRESHOLD && (
            <span className="plan-node-card__contribution" data-testid="contribution-badge">
              {Math.round(contributionPercent)}%
            </span>
          )}
        </div>
        {subtitle && (
          <div className="plan-node-card__subtitle" title={subtitle}>
            {subtitle}
          </div>
        )}
        <div className="plan-node-card__meta">{formatMeta(planNode)}</div>
        {/* Story 14.2's AC: a changed node shows "the specific delta ... e.g.
            Seq Scan -> Index Scan, cost/time delta" directly, not tucked
            behind a click — visible highlighting, same spirit as the
            mismatch badge above. */}
        {comparisonOverlay?.status === "changed" && comparisonOverlay.counterpart && (
          <div className="plan-node-card__comparison-delta" data-testid="comparison-delta">
            {formatComparisonDelta(planNode, comparisonOverlay.counterpart)}
          </div>
        )}
        <div className="plan-node-card__badges">
          {hasMismatch && (
            <span className={badgeClassName()} data-testid="mismatch-badge">
              est. mismatch{mismatchFactor !== undefined ? ` ${mismatchFactor}×` : ""}
            </span>
          )}
          {loopCount !== undefined && (
            <span className="plan-node-card__badge" data-testid="loop-badge">
              ×{loopCount.toLocaleString("en-US")}
            </span>
          )}
          {/* Design-mockup review (post-Episode-18): spec §3's badge table
              names "spill size" as its own badge. Design review (downloaded
              main-canvas mockup, its own saved source): its spill/mismatch
              badges ARE severity-tinted after all — supersedes this badge's
              earlier neutral treatment (the anti-redundancy reasoning that
              used to live here). Tinted by this node's OWN worst severity
              (severityBadgeClass, same value the ring above uses) — never a
              badge type hardcoded to one color, since a rule like sortDisk-
              Spill's own severity is graded (warning vs critical by spill
              size), not fixed. Loop count has no severity of its own and
              stays plain, same as always. */}
          {spillBadgeText && (
            <span className={badgeClassName()} data-testid="spill-badge">
              {spillBadgeText}
            </span>
          )}
          {comparisonOverlay && comparisonOverlay.status !== "matched" && (
            <span
              className={`plan-node-card__badge plan-node-card__badge--comparison-${comparisonOverlay.status}`}
              data-testid="comparison-badge"
            >
              {COMPARISON_BADGE_TEXT[comparisonOverlay.status]}
            </span>
          )}
        </div>
      </div>
      {tooltip && (
        <div className="plan-node-card__tooltip" data-testid="plan-node-tooltip" role="tooltip">
          {tooltip}
        </div>
      )}
    </div>
  )
}

function formatMeta(planNode: PlanNodeData["planNode"]): string {
  const rows = planNode.actualRows ?? planNode.estimatedRows
  const time = planNode.actualTimeMs
  const parts: string[] = []
  if (rows !== undefined) parts.push(`${rows.toLocaleString("en-US")} rows`)
  if (time !== undefined) parts.push(`${time.toFixed(1)}ms`)
  return parts.join(" · ")
}

/** "Seq Scan -> Index Scan", plus a cost or time delta line when both sides
 * report a comparable figure — never a fabricated delta when one side is
 * missing the field (e.g. Snowflake's actualTimeMs, which is intentionally
 * left undefined; see normalize.ts's TimeBreakdownInfo comment). */
function formatComparisonDelta(planNode: PlanNodeData["planNode"], counterpart: NonNullable<ComparisonOverlay["counterpart"]>): string {
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
