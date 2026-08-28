import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { AccessiblePlanList } from "./canvas/AccessiblePlanList"
import { CanvasPlanGraph } from "./canvas/CanvasPlanGraph"
import { computeDefaultCollapsedIds, findCollapsedAncestors } from "./collapse"
import { DetailPanel } from "./detailPanel/DetailPanel"
import type { MetricKey } from "./encoding"
import { PlanNodeCard } from "./PlanNodeCard"
import { CollapsedGroupNode } from "./CollapsedGroupNode"
import "./planGraph.css"

const nodeTypes: NodeTypes = {
  planNode: PlanNodeCard,
  collapsedGroup: CollapsedGroupNode,
}

// Below this, PlanNodeCard's 12px label is no longer legible. Governs both
// fitView's floor (below) and <ReactFlow>'s own minZoom, so manual scroll-to-
// zoom can't reach the same illegible scale fitView is capped away from.
const MIN_LEGIBLE_ZOOM = 0.5

// Episode 15 — above this node count, React Flow's one-DOM-element-per-node
// rendering is the documented risk to interaction responsiveness (Story
// 15.1's premise); the canvas path (src/graph/canvas/) takes over instead.
// Chosen to sit comfortably below Episode 6's own 500-node collapse-by-
// default risk point, not derived from a real browser benchmark run in
// this session — the story's testing approach calls for exactly that
// benchmark (50/100/250/500/1000+ node sizes, render + interaction
// latency) before trusting this number in production. Revisit then.
export const CANVAS_NODE_COUNT_THRESHOLD = 300

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
  /** Story 13.1: the "All findings" list sets this to navigate the graph to
   * and open the detail panel for a specific node (e.g. clicking a finding
   * entry). Any collapsed ancestor standing between the root and this node
   * is expanded so it becomes visible, not just openable. Read once per
   * change (an effect, not a controlled render prop) — after handling it,
   * `onFocusHandled` is called so the same id can be re-focused again later
   * without the caller needing to clear-then-set it. */
  focusNodeId?: string
  onFocusHandled?: () => void
}

function PlanGraphInner({ root, metric = "actualTimeMs", context, focusNodeId, onFocusHandled }: PlanGraphProps) {
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

  // Whatever had focus right before the panel opened (a clicked or
  // keyboard-activated card) — restored on close so focus doesn't silently
  // fall back to the document body, standard modal/panel accessibility
  // practice. Captured here (not in DetailPanel) since this is the
  // component that actually knows what triggered the open.
  const triggerElementRef = useRef<HTMLElement | null>(null)
  const openPanel = useCallback((nodeId: string) => {
    triggerElementRef.current = document.activeElement as HTMLElement | null
    setSelectedNodeId(nodeId)
  }, [])
  const closePanel = useCallback(() => {
    setSelectedNodeId(undefined)
    triggerElementRef.current?.focus()
  }, [])

  // Story 13.1: handle an externally requested focus (a click in the "All
  // findings" list). Expanding any collapsed ancestor first means the
  // fitView effect below (which re-runs on `nodes.length` change) brings
  // the newly-revealed node into view, not just the panel.
  useEffect(() => {
    if (focusNodeId === undefined) return
    setCollapsedIds((prev) => {
      const toReveal = findCollapsedAncestors(root, focusNodeId, prev)
      if (toReveal.size === 0) return prev
      const next = new Set(prev)
      toReveal.forEach((id) => next.delete(id))
      return next
    })
    setSelectedNodeId(focusNodeId)
    onFocusHandled?.()
    // onFocusHandled intentionally excluded from deps: it's a fire-once
    // callback, not reactive state this effect should re-run for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, root])

  // Reset collapse/selection state when a genuinely new plan arrives (a
  // fresh parse result — object identity, not just an equal id, since ids
  // restart from "n0" on every parse). This is React's documented "adjust
  // state during render" pattern for resetting on a prop change: a plain
  // conditional setState call while rendering, not inside an effect, so it
  // doesn't trigger the extra render-then-effect round trip a useEffect would.
  // Story 15.2: which surface is showing when canvas mode is active — the
  // control to reach it is always present and prominent (rendered right
  // alongside the canvas, never buried), but the accessible list's DOM is
  // only actually mounted once opened, so a huge plan a user never opens it
  // for doesn't pay its render cost — the whole reason canvas mode exists.
  const [showAccessibleList, setShowAccessibleList] = useState(false)

  const [prevRoot, setPrevRoot] = useState(root)
  if (root !== prevRoot) {
    setPrevRoot(root)
    setCollapsedIds(computeDefaultCollapsedIds(root, allNodes))
    setSelectedNodeId(undefined)
    setShowAccessibleList(false)
  }

  const { nodes, edges } = useMemo(
    () => buildGraphElements(root, { metric, collapsedIds }),
    [root, metric, collapsedIds],
  )

  const useCanvas = allNodes.length > CANVAS_NODE_COUNT_THRESHOLD

  const expandCollapsedGroup = useCallback((parentPlanNodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(parentPlanNodeId)
      return next
    })
  }, [])

  const { fitView } = useReactFlow()
  useEffect(() => {
    if (useCanvas) return // the DOM/SVG <ReactFlow> tree below isn't rendered in this mode — nothing to fit
    // Large plans must never render pre-zoomed to an unreadable scale —
    // fit on every shape change (initial load, expand/collapse), not just once.
    // Floored at MIN_LEGIBLE_ZOOM: for a 500+-node plan, fitting every node into
    // the fixed-size viewport would otherwise zoom out far past PlanNodeCard's
    // 12px label legibility. Once capped, a large plan overflows the viewport
    // instead — React Flow's own pan/scroll already handles that for free.
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.2, duration: 200, minZoom: MIN_LEGIBLE_ZOOM }),
    )
    return () => cancelAnimationFrame(frame)
  }, [nodes.length, fitView, useCanvas])

  const handleNodeClick = useCallback<NodeMouseHandler<PlanGraphNode>>((_event, node) => {
    if (node.type === "collapsedGroup") {
      expandCollapsedGroup(node.data.parentPlanNodeId)
      return
    }
    openPanel(node.id)
  }, [openPanel, expandCollapsedGroup])

  const selectedNode = selectedNodeId !== undefined ? allNodes.find((n) => n.id === selectedNodeId) : undefined

  // Keyboard access (Story 6.2's accessibility acceptance criterion: the
  // panel opens via Enter/Space on a focused node) needs each card to call
  // back into this component's own selection state — attached here, after
  // buildGraphElements produces its otherwise-plain, testable node data,
  // rather than baked into that pure conversion function itself.
  const nodesWithHandlers = useMemo(
    () =>
      useCanvas ? nodes : nodes.map((n) => (n.type === "planNode" ? { ...n, data: { ...n.data, onOpen: () => openPanel(n.id) } } : n)),
    [nodes, openPanel, useCanvas],
  )

  if (useCanvas) {
    return (
      <div className="plan-graph plan-graph--canvas" data-testid="plan-graph">
        <div className="plan-graph__canvas-toolbar">
          <button
            type="button"
            className="plan-graph__accessible-list-toggle"
            data-testid="accessible-list-toggle"
            aria-pressed={showAccessibleList}
            onClick={() => setShowAccessibleList((v) => !v)}
          >
            {showAccessibleList ? "Back to graph view" : "View as accessible list"}
          </button>
        </div>
        {showAccessibleList ? (
          <AccessiblePlanList
            root={root}
            collapsedIds={collapsedIds}
            selectedNodeId={selectedNodeId}
            onSelectNode={openPanel}
            onExpandCollapsedGroup={expandCollapsedGroup}
          />
        ) : (
          <CanvasPlanGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={openPanel}
            onExpandCollapsedGroup={expandCollapsedGroup}
          />
        )}
        {selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
      </div>
    )
  }

  return (
    <div className="plan-graph" data-testid="plan-graph">
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        proOptions={{ hideAttribution: true }}
        minZoom={MIN_LEGIBLE_ZOOM}
        maxZoom={2}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
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
