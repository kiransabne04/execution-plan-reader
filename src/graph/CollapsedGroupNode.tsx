import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import type { CollapsedGroupNodeData } from "./buildGraphElements"

type CollapsedGroupNodeProps = NodeProps<Node<CollapsedGroupNodeData, "collapsedGroup">>

/** Placeholder for a subtree collapsed by default (large-plan performance
 * edge case) — clicking it expands that subtree back in. Click handling
 * lives in PlanGraph's onNodeClick, not here, so this stays a pure
 * presentational component. */
export function CollapsedGroupNode({ data }: CollapsedGroupNodeProps) {
  return (
    <div className="collapsed-group-node" data-testid="collapsed-group-node">
      <Handle type="target" position={Position.Top} />
      +{data.hiddenNodeCount.toLocaleString("en-US")} node{data.hiddenNodeCount === 1 ? "" : "s"} hidden — click to expand
    </div>
  )
}
