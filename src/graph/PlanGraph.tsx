import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { collectNodes, type PlanNode } from "../parsers/normalize"
import { buildPlanContext, type PlanContext } from "../rules/types"
import { buildGraphElements, type PlanGraphNode } from "./buildGraphElements"
import { computeDefaultCollapsedIds } from "./collapse"
import { DetailPanel } from "./detailPanel/DetailPanel"
import type { MetricKey } from "./encoding"
import { PlanNodeCard } from "./PlanNodeCard"
import { CollapsedGroupNode } from "./CollapsedGroupNode"
import "./planGraph.css"

const nodeTypes: NodeTypes = {
  planNode: PlanNodeCard,
  collapsedGroup: CollapsedGroupNode,
}

export interface PlanGraphProps {
  root: PlanNode
  /** "Actual time when available, estimated cost otherwise" is the default
   * per the technical spec; callers (a future legend toggle) can override. */
  metric?: MetricKey
  /** The context the rule engine ran with, so the detail panel's
   * contribution-%/query-correlation sections see the same statement text
   * and totals the rules themselves used. Defaults to a bare context built
   * from `root` alone (fine for standalone use/tests; a real page should
   * pass the actual context from `analyzePlan`). */
  context?: PlanContext
}

function PlanGraphInner({ root, metric = "actualTimeMs", context }: PlanGraphProps) {
  const allNodes = useMemo(() => collectNodes(root), [root])
  const resolvedContext = useMemo(() => context ?? buildPlanContext(root), [context, root])

  // Collapse state lives here, keyed by PlanNode id — never on the PlanNode
  // model itself, which stays pure/serializable. Which subtrees are
  // "insignificant enough to hide" is independent of which metric is
  // currently on display — always judged on the same fixed basis, so
  // switching the (future) legend toggle never silently re-collapses
  // something the user just expanded.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => computeDefaultCollapsedIds(root, allNodes))

  // Which node's detail panel is open, if any — local UI state, never on
  // the PlanNode model itself.
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined)

  // Reset collapse/selection state when a genuinely new plan arrives (a
  // fresh parse result — object identity, not just an equal id, since ids
  // restart from "n0" on every parse). This is React's documented "adjust
  // state during render" pattern for resetting on a prop change: a plain
  // conditional setState call while rendering, not inside an effect, so it
  // doesn't trigger the extra render-then-effect round trip a useEffect would.
  const [prevRoot, setPrevRoot] = useState(root)
  if (root !== prevRoot) {
    setPrevRoot(root)
    setCollapsedIds(computeDefaultCollapsedIds(root, allNodes))
    setSelectedNodeId(undefined)
  }

  const { nodes, edges } = useMemo(
    () => buildGraphElements(root, { metric, collapsedIds }),
    [root, metric, collapsedIds],
  )

  const { fitView } = useReactFlow()
  useEffect(() => {
    // Large plans must never render pre-zoomed to an unreadable scale —
    // fit on every shape change (initial load, expand/collapse), not just once.
    const frame = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }))
    return () => cancelAnimationFrame(frame)
  }, [nodes.length, fitView])

  const handleNodeClick = useCallback<NodeMouseHandler<PlanGraphNode>>((_event, node) => {
    if (node.type === "collapsedGroup") {
      const parentPlanNodeId = node.data.parentPlanNodeId
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        next.delete(parentPlanNodeId)
        return next
      })
      return
    }
    setSelectedNodeId(node.id)
  }, [])

  const selectedNode = selectedNodeId !== undefined ? allNodes.find((n) => n.id === selectedNodeId) : undefined

  // Keyboard access (Story 6.2's accessibility acceptance criterion: the
  // panel opens via Enter/Space on a focused node) needs each card to call
  // back into this component's own selection state — attached here, after
  // buildGraphElements produces its otherwise-plain, testable node data,
  // rather than baked into that pure conversion function itself.
  const nodesWithHandlers = useMemo(
    () =>
      nodes.map((n) =>
        n.type === "planNode" ? { ...n, data: { ...n.data, onOpen: () => setSelectedNodeId(n.id) } } : n,
      ),
    [nodes],
  )

  return (
    <div className="plan-graph" data-testid="plan-graph">
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
        minZoom={0.05}
        maxZoom={2}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {selectedNode && (
        <DetailPanel node={selectedNode} context={resolvedContext} onClose={() => setSelectedNodeId(undefined)} />
      )}
    </div>
  )
}

/** Self-contained: wraps its own ReactFlowProvider so callers don't need to
 * know React Flow needs one (fitView/useReactFlow require it). */
export function PlanGraph(props: PlanGraphProps) {
  return (
    <ReactFlowProvider>
      <PlanGraphInner {...props} />
    </ReactFlowProvider>
  )
}
