import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import type { PlanNodeData } from "./buildGraphElements"

type PlanNodeCardProps = NodeProps<Node<PlanNodeData, "planNode">>

export function PlanNodeCard({ data }: PlanNodeCardProps) {
  const { planNode, color, hasMismatch, loopCount } = data
  const className = hasMismatch ? "plan-node-card plan-node-card--mismatch" : "plan-node-card"

  return (
    <div
      className={className}
      style={{ borderColor: hasMismatch ? undefined : color, background: `color-mix(in srgb, ${color} 18%, var(--pg-card-bg))` }}
      title={planNode.rawOperatorLabel}
      data-testid="plan-node-card"
      data-node-id={planNode.id}
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
