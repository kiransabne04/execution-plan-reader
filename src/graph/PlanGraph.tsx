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
import { buildGraphElements, type ComparisonOverlay, type PlanGraphNode } from "./buildGraphElements"
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
  /** Episode 14, Story 14.2 — keyed by this tree's own PlanNode id, from a
   * `matchNodes` result. Absent for a plain single-plan render. */
  comparisonOverlays?: Map<string, ComparisonOverlay>
  /** Story 14.2's synced selection: fires with the newly selected node id
   * (or `undefined` on close) when a selection *originates in this pane* —
   * a click or keyboard activation, never an incoming `focusNodeId` (that
   * would echo straight back to whoever just set it — see the effect below
   * for why). A comparison view uses this to drive the OTHER pane's
   * `focusNodeId` — see PlanComparisonView.tsx. Optional and additive:
   * omitting it changes nothing about single-plan behavior. */
  onNodeSelected?: (nodeId: string | undefined) => void
  /** Story 18.2 — the app shell wants the detail panel rendered as a true
   * grid track (a sibling of the rails, not nested inside PlanGraph's own
   * DOM), so it can be a normal document-flow element above 1180px and an
   * overlay-with-scrim below it — see docs/12-ui-redesign-spec.md §2's
   * breakpoint table. When true, PlanGraph stops rendering `<DetailPanel>`
   * itself and instead reports the panel's contents via
   * `onDetailPanelChange`; selection state and focus-restoration (this
   * component already owns both) are unaffected — only WHERE the panel's
   * JSX gets mounted changes. Defaults to false: PlanComparisonView
   * (Episode 14) isn't part of the app shell's grid and keeps the
   * original self-contained, always-fixed-overlay behavior unchanged. */
  externalDetailPanel?: boolean
  /** Required when `externalDetailPanel` is true. Fires whenever the open
   * node changes (including to `undefined` on close) with everything the
   * caller needs to render `<DetailPanel>` itself — `onClose` IS this
   * component's own `closePanel`, so Escape/the close button still restore
   * focus to the triggering card correctly even though the panel now
   * renders elsewhere in the tree. */
  onDetailPanelChange?: (panel: { node: PlanNode; context: PlanContext; onClose: () => void } | undefined) => void
  /** Story 18.8 — the active search/filter palette's result set, keyed by
   * this tree's own PlanNode id. Every OTHER node dims to 32% opacity
   * (buildGraphElements.ts's `isDimmed`) rather than disappearing — see
   * docs/12-ui-redesign-spec.md §5 `1h`. `undefined` (no search active)
   * means every node renders at full opacity, same as before this story. */
  matchedNodeIds?: Set<string>
}

function PlanGraphInner({
  root,
  metric = "actualTimeMs",
  context,
  focusNodeId,
  onFocusHandled,
  comparisonOverlays,
  onNodeSelected,
  externalDetailPanel = false,
  onDetailPanelChange,
  matchedNodeIds,
}: PlanGraphProps) {
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

  // Story 14.2: a node an incoming `focusNodeId` asked us to pan to, held
  // separately from `focusNodeId` itself (which the parent clears via
  // `onFocusHandled` moments after this fires — see the effect below) so
  // the pan can still resolve one commit later, once a just-expanded
  // ancestor's `nodes` actually contains this id. Only ever set by an
  // external focus request, never by a plain click, so ordinary in-graph
  // clicking never yanks the camera — that's not what this is for.
  const [pendingPanNodeId, setPendingPanNodeId] = useState<string | undefined>(undefined)

  // Whatever had focus right before the panel opened (a clicked or
  // keyboard-activated card) — restored on close so focus doesn't silently
  // fall back to the document body, standard modal/panel accessibility
  // practice. Captured here (not in DetailPanel) since this is the
  // component that actually knows what triggered the open.
  const triggerElementRef = useRef<HTMLElement | null>(null)
  const openPanel = useCallback((nodeId: string) => {
    triggerElementRef.current = document.activeElement as HTMLElement | null
    setSelectedNodeId(nodeId)
    onNodeSelected?.(nodeId)
  }, [onNodeSelected])
  const closePanel = useCallback(() => {
    setSelectedNodeId(undefined)
    triggerElementRef.current?.focus()
    onNodeSelected?.(undefined)
  }, [onNodeSelected])

  // Story 13.1: handle an externally requested focus (a click in the "All
  // findings" list, or — Story 14.2 — the OTHER pane of a comparison view
  // via onNodeSelected/focusNodeId). Expanding any collapsed ancestor first
  // means the fitView effect below (which re-runs on `nodes.length` change)
  // brings the newly-revealed node into view, not just the panel.
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
    setPendingPanNodeId(focusNodeId)
    // Deliberately NOT calling onNodeSelected here: this branch handles a
    // focus that arrived FROM the caller (Story 13.1's findings-list click,
    // or Story 14.2's other-pane sync below) — echoing it back out again
    // would round-trip straight back to whoever just set it. In a
    // PlanComparisonView, both panes do this symmetrically, so an echo here
    // becomes A -> B -> A -> B forever. onNodeSelected fires only for a
    // selection that actually originated in THIS pane (openPanel/closePanel
    // above) — that's the only direction that needs reporting outward.
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
    setPendingPanNodeId(undefined)
    setShowAccessibleList(false)
  }

  const { nodes, edges } = useMemo(
    () => buildGraphElements(root, { metric, collapsedIds, comparisonOverlays, matchedNodeIds }),
    [root, metric, collapsedIds, comparisonOverlays, matchedNodeIds],
  )

  const useCanvas = allNodes.length > CANVAS_NODE_COUNT_THRESHOLD

  const expandCollapsedGroup = useCallback((parentPlanNodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(parentPlanNodeId)
      return next
    })
  }, [])

  const { fitView, setCenter } = useReactFlow()
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

  // Story 14.2's "clicking a node in one plan ... scrolls to its matched
  // counterpart in the other": pan the OTHER pane's viewport to the newly-
  // focused node, not just open its panel. Keyed on `pendingPanNodeId`
  // rather than `focusNodeId` directly: when the target sat behind a
  // collapsed ancestor, the ancestor-expanding `setCollapsedIds` above only
  // takes effect on the NEXT render, so `nodes` here may not contain the
  // target yet on the render where `focusNodeId` was still set — by the
  // following render (`nodes` now including it), the parent has already
  // cleared `focusNodeId` via `onFocusHandled`. `pendingPanNodeId` survives
  // that clearing, so the pan still resolves once the node is actually
  // there. Canvas mode has no equivalent yet — same known gap as fitView
  // above; the accessible list's own scroll-into-view is the reachable
  // path there.
  useEffect(() => {
    if (useCanvas || pendingPanNodeId === undefined) return
    const target = nodes.find((n) => n.id === pendingPanNodeId)
    if (!target) return // still behind a collapsed ancestor — wait for the next `nodes` update
    const width = target.width ?? 160
    const height = target.height ?? 56
    const frame = requestAnimationFrame(() =>
      setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom: 1, duration: 300 }),
    )
    setPendingPanNodeId(undefined) // consumed
    return () => cancelAnimationFrame(frame)
  }, [pendingPanNodeId, nodes, useCanvas, setCenter])

  const handleNodeClick = useCallback<NodeMouseHandler<PlanGraphNode>>((_event, node) => {
    if (node.type === "collapsedGroup") {
      expandCollapsedGroup(node.data.parentPlanNodeId)
      return
    }
    openPanel(node.id)
  }, [openPanel, expandCollapsedGroup])

  const selectedNode = selectedNodeId !== undefined ? allNodes.find((n) => n.id === selectedNodeId) : undefined

  // Story 18.2 — report the panel outward instead of rendering it here,
  // when the caller has taken over placement. A plain effect (not computed
  // inline in the return below): `onDetailPanelChange` is how the PARENT's
  // own state gets updated, which has to happen as a reaction to this
  // component's state changing, not as a value read during render.
  useEffect(() => {
    if (!externalDetailPanel) return
    onDetailPanelChange?.(selectedNode ? { node: selectedNode, context: resolvedContext, onClose: closePanel } : undefined)
  }, [externalDetailPanel, selectedNode, resolvedContext, closePanel, onDetailPanelChange])

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
            comparisonOverlays={comparisonOverlays}
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
        {!externalDetailPanel && selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
      </div>
    )
  }

  return (
    <div className="plan-graph" data-testid="plan-graph">
      <EdgeArrowheadDefs />
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
      {!externalDetailPanel && selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
    </div>
  )
}

/**
 * Story 18.4, spec §4: "Arrowheads are a fixed 11px regardless of stroke
 * weight: markerUnits="userSpaceOnUse"... Default strokeWidth scaling makes
 * a 7px hot edge sprout a ~40px head." React Flow's own built-in
 * `markerEnd` option uses `markerUnits="strokeWidth"` internally (scales
 * WITH the edge, exactly the problem spec calls out) — a hand-defined
 * `<marker>` with `markerUnits="userSpaceOnUse"` is the only way to get a
 * genuinely fixed size. `marker-end: url(#id)` works across separate `<svg>`
 * elements in the same document, so this can render once here rather than
 * once per edge; each edge (buildGraphElements.ts) references one of these
 * two ids directly as a plain string. `orient="auto"` rotates the triangle
 * to match each edge's actual direction at its endpoint — no per-edge
 * rotation math needed even though smoothstep edges curve at different
 * angles depending on layout.
 */
function EdgeArrowheadDefs() {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <marker id="pg-arrow-hot" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={11} markerHeight={11} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" style={{ fill: "var(--color-edge-hot)" }} />
        </marker>
        <marker id="pg-arrow-muted" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={11} markerHeight={11} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 Z" style={{ fill: "var(--color-edge-muted)" }} />
        </marker>
      </defs>
    </svg>
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
