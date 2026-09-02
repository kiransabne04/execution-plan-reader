import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { collectNodes, type PlanNode } from "../parsers/normalize"
import { buildPlanContext, type PlanContext } from "../rules/types"
import { buildGraphElements, type ComparisonOverlay, type PlanGraphNode } from "./buildGraphElements"
import { AccessiblePlanList } from "./canvas/AccessiblePlanList"
import { CanvasPlanGraph } from "./canvas/CanvasPlanGraph"
import { resolveCssVar } from "./canvas/cssVars"
import { exportGraphToPngBlob } from "./canvas/exportPng"
import { computeDefaultCollapsedIds, findCollapsedAncestors } from "./collapse"
import { DetailPanel } from "./detailPanel/DetailPanel"
import { computePopupPosition } from "./detailPanel/popupPosition"
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
  /** Design review (docs/12-ui-redesign-spec.md §2's metrics strip:
   * "total, node count, collapsed count, colour legend...") — collapse
   * state lives here (keyed by PlanNode id, see the comment on
   * `collapsedIds` below), but the shell's metrics strip that DISPLAYS the
   * collapsed count renders outside this component entirely. Same
   * "report internal state outward for display elsewhere" pattern as
   * `onNodeSelected`/`onDetailPanelChange` above, not a second source of
   * truth — the shell never sets collapse state itself. */
  onCollapsedCountChange?: (count: number) => void
  /** Episode 22, Story 22.2 — "panel" (default) is every existing behavior
   * unchanged (the right-rail/overlay `DetailPanel`, via
   * `externalDetailPanel`/`onDetailPanelChange` or this component's own
   * internal render). "popup" is the app shell's maximized mode: this
   * component renders `DetailPanel` itself with `variant="popup"`,
   * positioned next to the clicked node via `flowToScreenPosition()` +
   * `computePopupPosition` — only this component (inside the
   * `ReactFlowProvider`) can compute that coordinate, so unlike the
   * "panel" path this isn't reported outward for the caller to render.
   * `onDetailPanelChange` still fires as normal either way (PlanReaderPage
   * uses it for its own Escape-stacking logic — see Story 22.1) even
   * though it no longer decides what gets rendered in "popup" mode.
   * Canvas-rendering mode (Story 22.3) is entirely separate — this prop
   * only affects the DOM/SVG branch below. */
  nodeDetailVariant?: "panel" | "popup"
}

/** Story 18.11 — the imperative surface a caller (the app bar's Export
 * button, which lives outside this component and has no reason to know
 * about `collapsedIds`/DOM-vs-canvas-mode) uses to trigger a PNG export.
 * A ref/imperative-handle, not a prop, because export is a one-shot
 * ACTION a caller triggers on demand — not state this component should
 * report outward continuously the way `onDetailPanelChange` does. */
export interface PlanGraphHandle {
  /** `null` when there's nothing to export or the browser couldn't
   * produce the image — see exportPng.ts's own doc comment. */
  exportPng: () => Promise<Blob | null>
}

const PlanGraphInner = forwardRef<PlanGraphHandle, PlanGraphProps>(function PlanGraphInner(
  {
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
    onCollapsedCountChange,
    nodeDetailVariant = "panel",
  }: PlanGraphProps,
  ref: ForwardedRef<PlanGraphHandle>,
) {
  const allNodes = useMemo(() => collectNodes(root), [root])
  const resolvedContext = useMemo(() => context ?? buildPlanContext(root), [context, root])

  // Collapse state lives here, keyed by PlanNode id — never on the PlanNode
  // model itself, which stays pure/serializable. Which subtrees are
  // "insignificant enough to hide" is independent of which metric is
  // currently on display — always judged on the same fixed basis, so
  // switching the (future) legend toggle never silently re-collapses
  // something the user just expanded.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => computeDefaultCollapsedIds(root, allNodes))

  // Reports the count outward whenever it changes — see this prop's own
  // doc comment on PlanGraphProps for why the shell needs this at all.
  useEffect(() => {
    onCollapsedCountChange?.(collapsedIds.size)
  }, [collapsedIds, onCollapsedCountChange])

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
    // Story 20.2: `{ preventScroll: true }` — the trigger element is
    // whatever was already focused/visible right before the panel opened;
    // restoring focus to it on close shouldn't independently scroll the
    // page to wherever it happens to sit (e.g. a statement tab far above
    // the graph in a large multi-statement batch).
    triggerElementRef.current?.focus({ preventScroll: true })
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
    () => buildGraphElements(root, { metric, collapsedIds, comparisonOverlays, matchedNodeIds, context: resolvedContext }),
    [root, metric, collapsedIds, comparisonOverlays, matchedNodeIds, resolvedContext],
  )

  const useCanvas = allNodes.length > CANVAS_NODE_COUNT_THRESHOLD

  const expandCollapsedGroup = useCallback((parentPlanNodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(parentPlanNodeId)
      return next
    })
  }, [])

  // Story 18.11 — the top-level wrapper (assigned below, on whichever of
  // the two branches at the bottom actually renders) so `exportPng` can
  // resolve this app's own CSS custom properties the exact same way
  // CanvasPlanGraph.tsx's own live rendering already does — export must
  // stay theme-consistent even in DOM/SVG mode, where no `.canvas-plan-
  // graph` element with those properties is otherwise on the page.
  const containerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(
    ref,
    () => ({
      exportPng: async () => {
        const el = containerRef.current
        if (!el) return null
        // Same fallbacks as CanvasPlanGraph.tsx's own resolveCssVar calls
        // (Story 18.1's dark-only palette) — export must produce a real
        // image even in a test/SSR environment with no live stylesheet.
        return exportGraphToPngBlob(nodes, edges, {
          textColor: resolveCssVar(el, "--pg-card-text", "#e9e9ed"),
          selectionColor: resolveCssVar(el, "--pg-canvas-selection", "#b5abfc"),
          backgroundColor: resolveCssVar(el, "--pg-card-bg", "#232532"),
          comparisonColors: {
            changed: resolveCssVar(el, "--pg-comparison-changed", "#f79009"),
            addedInB: resolveCssVar(el, "--pg-comparison-added", "#47cd89"),
            removedFromB: resolveCssVar(el, "--pg-comparison-removed", "#b692f6"),
          },
          edgeColors: {
            hot: resolveCssVar(el, "--color-edge-hot", "#8d6a6a"),
            muted: resolveCssVar(el, "--color-edge-muted", "#6b6f82"),
          },
          severityColors: {
            critical: resolveCssVar(el, "--color-critical", "#f97066"),
            warning: resolveCssVar(el, "--color-warning", "#f79009"),
          },
        })
      },
    }),
    [nodes, edges],
  )

  const { fitView, setCenter } = useReactFlow()
  useEffect(() => {
    if (useCanvas) return // the DOM/SVG <ReactFlow> tree below isn't rendered in this mode — nothing to fit
    // Large plans must never render pre-zoomed to an unreadable scale —
    // fit on every shape change (initial load, expand/collapse), not just once.
    // Floored at MIN_LEGIBLE_ZOOM: for a 500+-node plan, fitting every node into
    // the fixed-size viewport would otherwise zoom out far past PlanNodeCard's
    // 12px label legibility. Once capped, a large plan overflows the viewport
    // instead — React Flow's own pan/scroll already handles that for free.
    // Design review — extra fixed top padding (bigger than the persistent
    // search-trigger bar's own ~44px height, PlanReaderPage.tsx's
    // `.plan-shell__search-trigger`) so a bottom-up-laid-out plan's ROOT
    // node — dagre puts it at the very top, and fitView otherwise centers
    // the whole graph with no regard for that fixed overlay — never lands
    // directly behind it. Caught visually: a root node can end up
    // partially hidden under the search bar with the default uniform 20%
    // padding, which doesn't reserve space for anything screen-fixed.
    const frame = requestAnimationFrame(() =>
      fitView({
        padding: { top: "56px", left: "20%", right: "20%", bottom: "20%" },
        duration: 200,
        minZoom: MIN_LEGIBLE_ZOOM,
      }),
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
  // Episode 22, Story 22.2 — the SAME node's React Flow graph node (not the
  // plain PlanNode above), whose `position`/`width`/`height` the popup path
  // needs to compute a screen anchor. `undefined` while the node sits behind
  // a still-collapsed ancestor (same transient gap `pendingPanNodeId`'s own
  // effect already handles elsewhere in this file) — NodeDetailPopup below
  // simply doesn't render until `nodes` catches up on the next render.
  const selectedGraphNode = selectedNodeId !== undefined ? nodes.find((n) => n.id === selectedNodeId) : undefined

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
      <div className="plan-graph plan-graph--canvas" data-testid="plan-graph" ref={containerRef}>
        <div className="plan-graph__canvas-toolbar">
          {/* Story 18.10, spec §5 `1i` — explains the DOM->canvas switch
              rather than leaving a large plan to just feel like a
              different, possibly-broken tool. A local element (not
              src/app/Notice.tsx) deliberately: src/graph never imports
              from src/app (the composing layer imports FROM graph, not
              the reverse) — this matches Notice's info-tier visual
              language in planGraph.css without crossing that layering
              boundary for one banner. */}
          <p className="plan-graph__canvas-banner" data-testid="canvas-mode-banner" role="status">
            <span className="plan-graph__canvas-banner-label">Note:</span> This plan has {allNodes.length.toLocaleString("en-US")} nodes —
            switched to a faster rendering mode for large plans. Everything still works the same.
          </p>
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
    <div className="plan-graph" data-testid="plan-graph" ref={containerRef}>
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
        {/* Design review (reference mock) — top-right, matching the mock's
            zoom controls, not React Flow's own bottom-left default; the
            mock shows only zoom in/out/fit-view, not the fourth
            "toggle interactivity" lock button React Flow adds by default. */}
        <Controls className="plan-graph-controls" position="top-right" showInteractive={false} />
      </ReactFlow>
      {/* Episode 22, Story 22.2 — "popup" mode renders its own node-anchored
          `DetailPanel`, computed by `NodeDetailPopup` below, instead of the
          existing "report outward via onDetailPanelChange, caller renders
          it" path: only a component inside THIS `<ReactFlowProvider>` can
          call `flowToScreenPosition()`/`useViewport()` to get a screen
          coordinate at all, so the popup can't be assembled purely from
          outside this component the way the right-rail/overlay panel is.
          `onDetailPanelChange` (the effect above) still fires either way —
          PlanReaderPage's own Escape-stacking logic (Story 22.1) still
          needs to know a panel/popup is open, even though it no longer
          decides what gets rendered here. */}
      {nodeDetailVariant === "popup"
        ? selectedNode &&
          selectedGraphNode && <NodeDetailPopup node={selectedNode} graphNode={selectedGraphNode} context={resolvedContext} onClose={closePanel} />
        : !externalDetailPanel && selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
    </div>
  )
})

/** Episode 22, Story 22.2 — a small component of its own (not inlined into
 * `PlanGraphInner` above) specifically so `useViewport()` — which
 * re-renders its OWN component on every pan/zoom tick, the mechanism this
 * story's own AC relies on for "live-repositioning, no separate tracking
 * loop" — only re-runs while a popup is actually mounted. Inlining this
 * into `PlanGraphInner` directly would subscribe the ENTIRE graph (every
 * node, the whole `ReactFlow` tree) to re-render on every pan/zoom tick
 * even when no popup is open, a real, avoidable performance cost for
 * ordinary panning that has nothing to do with this feature. */
function NodeDetailPopup({
  node,
  graphNode,
  context,
  onClose,
}: {
  node: PlanNode
  graphNode: PlanGraphNode
  context: PlanContext
  onClose: () => void
}) {
  const { flowToScreenPosition } = useReactFlow()
  // Subscribing to the live viewport (not just reading it once) is the
  // whole mechanism here: React Flow re-renders this component on every
  // pan/zoom tick, so `flowToScreenPosition` below is re-evaluated against
  // the CURRENT transform every time — the "confirmed with the user: live-
  // reposition every frame, not close-on-pan/zoom" behavior falls out of
  // ordinary React re-rendering, not a bespoke animation loop.
  const { zoom } = useViewport()
  const width = graphNode.width ?? 160
  const height = graphNode.height ?? 56
  const screenTopLeft = flowToScreenPosition({ x: graphNode.position.x, y: graphNode.position.y })
  const anchor = { x: screenTopLeft.x, y: screenTopLeft.y, width: width * zoom, height: height * zoom }
  // Matches detailPanel.css's `.detail-panel--popup` sizing
  // (`min(360px, ...)`/`min(70vh, 520px)`) — an upper-bound estimate for
  // clamping purposes, not a real DOM measurement (the panel's actual
  // rendered height is content-dependent, capped by that same max-height).
  const position = computePopupPosition(anchor, { width: 360, height: 520 }, { width: window.innerWidth, height: window.innerHeight })
  return <DetailPanel node={node} context={context} onClose={onClose} variant="popup" position={position} />
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
 * know React Flow needs one (fitView/useReactFlow require it). Forwards a
 * ref straight through to `PlanGraphInner` (Story 18.11's `PlanGraphHandle`)
 * — this wrapper adds no imperative behavior of its own. */
export const PlanGraph = forwardRef<PlanGraphHandle, PlanGraphProps>(function PlanGraph(props, ref) {
  return (
    <ReactFlowProvider>
      <PlanGraphInner {...props} ref={ref} />
    </ReactFlowProvider>
  )
})
