import type { KeyboardEvent, MouseEvent } from "react"
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import type { ComparisonOverlay, PlanNodeData } from "./buildGraphElements"
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

export function PlanNodeCard({ data }: PlanNodeCardProps) {
  const { planNode, color, hasMismatch, loopCount, comparisonOverlay, onOpen } = data
  const classNames = ["plan-node-card"]
  if (hasMismatch) classNames.push("plan-node-card--mismatch")
  if (comparisonOverlay && comparisonOverlay.status !== "matched") {
    classNames.push(COMPARISON_MODIFIER_CLASS[comparisonOverlay.status])
  }
  const className = classNames.join(" ")
  // Hover tooltip (graph-visualization skill: hover tooltip and click detail
  // panel are two separate components) — CSS-only reveal (:hover/:focus-
  // within in planGraph.css), no extra state or render cost per card, and
  // the same content stays reachable via keyboard focus, not mouse-only.
  const tooltip = buildNodeTooltip(planNode)

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
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus()
  }

  return (
    // Outer wrapper (no overflow clipping, unlike .plan-node-card itself,
    // which needs overflow:hidden for its label/meta text-overflow ellipsis)
    // — the tooltip is this wrapper's sibling-of-the-card, not its child, so
    // it can render outside the small card's bounds instead of being clipped.
    <div className="plan-node-card-wrapper">
      <div
        className={className}
        style={{
          // undefined here lets the mismatch/comparison CSS class's own
          // border-color win instead of this inline metric-encoded color —
          // an inline style always beats a class on specificity, so this is
          // the one place that distinction actually has to be made explicit.
          borderColor: hasMismatch || (comparisonOverlay && comparisonOverlay.status !== "matched") ? undefined : color,
          background: `color-mix(in srgb, ${color} 18%, var(--pg-card-bg))`,
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
        <Handle type="target" position={Position.Top} />
        <div className="plan-node-card__label">{planNode.rawOperatorLabel}</div>
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
            <span className="plan-node-card__badge" data-testid="mismatch-badge">
              est. mismatch
            </span>
          )}
          {loopCount !== undefined && (
            <span className="plan-node-card__badge" data-testid="loop-badge">
              ×{loopCount.toLocaleString("en-US")}
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
        <Handle type="source" position={Position.Bottom} />
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
