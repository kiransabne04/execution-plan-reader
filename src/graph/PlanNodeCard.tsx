import type { KeyboardEvent, MouseEvent } from "react"
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import type { PlanNodeData } from "./buildGraphElements"

type PlanNodeCardProps = NodeProps<Node<PlanNodeData, "planNode">>

export function PlanNodeCard({ data }: PlanNodeCardProps) {
  const { planNode, color, hasMismatch, loopCount, onOpen } = data
  const className = hasMismatch ? "plan-node-card plan-node-card--mismatch" : "plan-node-card"

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
    <div
      className={className}
      style={{ borderColor: hasMismatch ? undefined : color, background: `color-mix(in srgb, ${color} 18%, var(--pg-card-bg))` }}
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
      </div>
      <Handle type="source" position={Position.Bottom} />
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
