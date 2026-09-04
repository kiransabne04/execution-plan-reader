import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef } from "react"
import { collectNodes, type PlanNode } from "../parsers/normalize"
import { buildPlanContext, type PlanContext } from "../rules/types"
import { buildGraphElements, type ComparisonOverlay } from "./buildGraphElements"
import { AccessiblePlanList } from "./canvas/AccessiblePlanList"
import { CanvasPlanGraph } from "./canvas/CanvasPlanGraph"
import { resolveCssVar } from "./canvas/cssVars"
import { exportGraphToPngBlob } from "./canvas/exportPng"
import { computeDefaultCollapsedIds, findCollapsedAncestors } from "./collapse"
import { DetailPanel } from "./detailPanel/DetailPanel"
import { computePopupPosition } from "./detailPanel/popupPosition"
import type { MetricKey } from "./encoding"
import "./planGraph.css"

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
  /** Episode 22, Story 22.3 (and, since Episode 26 Story 26.1, the ONLY
   * mode there is) — "panel" (default) is every existing behavior
   * unchanged (the right-rail/overlay `DetailPanel`, via
   * `externalDetailPanel`/`onDetailPanelChange` or this component's own
   * internal render). "popup" is the app shell's maximized mode: this
   * component renders `DetailPanel` itself with `variant="popup"`,
   * positioned next to the clicked node, via `CanvasPlanGraph`'s own
   * `onSelectedNodeScreenAnchorChange` + `worldToScreen`
   * (`CanvasNodeDetailPopup` below) — only `CanvasPlanGraph` can compute
   * that coordinate, so unlike the "panel" path this isn't reported
   * outward for the caller to render. `onDetailPanelChange` still fires as
   * normal either way (PlanReaderPage uses it for its own Escape-stacking
   * logic — see Story 22.1) even though it no longer decides what gets
   * rendered in "popup" mode. The accessible-list fallback (Story 15.2)
   * keeps the plain panel/overlay behavior even when this is "popup" — it
   * has no node-position concept to anchor a popup to (this episode's own
   * edge case). */
  nodeDetailVariant?: "panel" | "popup"
}

/** Story 18.11 — the imperative surface a caller (the app bar's Export
 * button, which lives outside this component and has no reason to know
 * about `collapsedIds`) uses to trigger a PNG export. A ref/imperative-
 * handle, not a prop, because export is a one-shot ACTION a caller
 * triggers on demand — not state this component should report outward
 * continuously the way `onDetailPanelChange` does. */
export interface PlanGraphHandle {
  /** `null` when there's nothing to export or the browser couldn't
   * produce the image — see exportPng.ts's own doc comment. */
  exportPng: () => Promise<Blob | null>
}

export const PlanGraph = forwardRef<PlanGraphHandle, PlanGraphProps>(function PlanGraph(
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

  // Story 14.2 (and, since Episode 26 Story 26.1, every caller of this —
  // guided walkthrough step advance, the Findings/Issues list, the
  // search palette, and comparison-view synced selection): a node an
  // incoming `focusNodeId` asked us to pan to, held separately from
  // `focusNodeId` itself (which the parent clears via `onFocusHandled`
  // moments after this fires — see the effect below) so the pan can still
  // resolve one commit later, once a just-expanded ancestor's `nodes`
  // actually contains this id. Only ever set by an external focus request,
  // never by a plain click, so ordinary in-graph clicking never yanks the
  // camera — that's not what this is for. Consumed by `CanvasPlanGraph`
  // itself (its own `panToNodeId`/`onPanHandled` props) rather than a pan
  // effect living here — see that component's doc comment.
  const [pendingPanNodeId, setPendingPanNodeId] = useState<string | undefined>(undefined)
  const handlePanHandled = useCallback(() => setPendingPanNodeId(undefined), [])

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
  // findings"/Issues list, or — Story 14.2 — the OTHER pane of a
  // comparison view via onNodeSelected/focusNodeId). Expanding any
  // collapsed ancestor first means `nodes` (recomputed below on
  // `collapsedIds` change) brings the newly-revealed node into view, not
  // just the panel.
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
  // The control to reach the accessible list is always present and
  // prominent (rendered right alongside the canvas, never buried), but its
  // DOM is only actually mounted once opened, so a huge plan a user never
  // opens it for doesn't pay its render cost.
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

  const expandCollapsedGroup = useCallback((parentPlanNodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(parentPlanNodeId)
      return next
    })
  }, [])

  // Story 18.11 — the top-level wrapper ref so `exportPng` can resolve this
  // app's own CSS custom properties the exact same way CanvasPlanGraph.tsx's
  // own live rendering already does.
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
          // Episode 26, Story 26.7 — the canvas background, not the card/
          // surface color (see ExportPngColors's own doc comment: node
          // cards are flat-filled with the surface color now, so the page
          // background has to be visibly different from it).
          backgroundColor: resolveCssVar(el, "--color-bg-canvas", "#12131d"),
          nodeSurfaceColor: resolveCssVar(el, "--pg-card-bg", "#232532"),
          nodeBorderColor: resolveCssVar(el, "--color-border-strong", "#3f424d"),
          nodeAccentColor: resolveCssVar(el, "--color-accent", "#9184d9"),
          badgeNeutralBg: resolveCssVar(el, "--color-border", "rgba(233, 233, 237, 0.12)"),
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

  const selectedNode = selectedNodeId !== undefined ? allNodes.find((n) => n.id === selectedNodeId) : undefined

  // Episode 22, Story 22.3 — canvas mode's own equivalent of what used to be
  // the DOM/SVG path's `flowToScreenPosition()`-derived anchor: reported
  // outward by `CanvasPlanGraph` (it's the one that owns the live pan/zoom
  // `transform` and the canvas element's own `getBoundingClientRect()`) via
  // `onSelectedNodeScreenAnchorChange`, on every pan/drag/wheel-zoom tick —
  // that's the live-repositioning mechanism, not a separate loop here.
  const [canvasPopupAnchor, setCanvasPopupAnchor] = useState<{ x: number; y: number; width: number; height: number } | undefined>(undefined)

  // Story 18.2 — report the panel outward instead of rendering it here,
  // when the caller has taken over placement. A plain effect (not computed
  // inline in the return below): `onDetailPanelChange` is how the PARENT's
  // own state gets updated, which has to happen as a reaction to this
  // component's state changing, not as a value read during render.
  useEffect(() => {
    if (!externalDetailPanel) return
    onDetailPanelChange?.(selectedNode ? { node: selectedNode, context: resolvedContext, onClose: closePanel } : undefined)
  }, [externalDetailPanel, selectedNode, resolvedContext, closePanel, onDetailPanelChange])

  return (
    <div className="plan-graph" data-testid="plan-graph" ref={containerRef}>
      <div className={`plan-graph__canvas-toolbar${nodeDetailVariant === "popup" ? " plan-graph__canvas-toolbar--popup-mode" : ""}`}>
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
          panToNodeId={pendingPanNodeId}
          onPanHandled={handlePanHandled}
          // Story 22.3 — only wired up in popup mode: the accessible list
          // has no node-position concept to anchor a popup to at all (this
          // episode's own edge-case table), and it isn't even mounted
          // alongside CanvasPlanGraph (the ternary above), so this only
          // ever matters for the branch that's actually showing. Passing
          // `undefined` in "panel" mode is deliberate, not an oversight —
          // it makes CanvasPlanGraph's own reporting effect a no-op.
          onSelectedNodeScreenAnchorChange={nodeDetailVariant === "popup" ? setCanvasPopupAnchor : undefined}
        />
      )}
      {/* Story 22.3 — "popup" vs "panel", with one extra wrinkle "popup"
          mode alone doesn't have: the accessible list (Story 15.2) has no
          node-position concept to anchor a popup to at all (this episode's
          own edge-case table). `nodeDetailVariant === "popup"` is also,
          from the caller's own perspective, the signal that it's hidden
          ITS external rendering (PlanReaderPage suppresses the right rail
          while maximized, trusting a popup to show instead — see Story
          22.1) — so when BOTH are true (maximized AND the accessible list
          is showing), neither the popup NOR the caller's own external
          panel is reachable unless this component falls back to rendering
          directly itself, `externalDetailPanel` notwithstanding. This is a
          real, found-via-testing gap this line specifically closes:
          without it, opening a node through the accessible list while
          maximized silently showed nothing at all. */}
      {nodeDetailVariant === "popup"
        ? showAccessibleList
          ? selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />
          : selectedNode &&
            canvasPopupAnchor && <CanvasNodeDetailPopup node={selectedNode} context={resolvedContext} onClose={closePanel} anchor={canvasPopupAnchor} />
        : !externalDetailPanel && selectedNode && <DetailPanel node={selectedNode} context={resolvedContext} onClose={closePanel} />}
    </div>
  )
})

/** Matches detailPanel.css's `.detail-panel--popup` sizing (`min(360px,
 * ...)`/`min(70vh, 520px)`) — an upper-bound estimate for clamping
 * purposes, not a real DOM measurement (the panel's actual rendered height
 * is content-dependent, capped by that same max-height). */
const POPUP_ESTIMATED_SIZE = { width: 360, height: 520 }

/** `window.innerWidth`/`innerHeight` is the right viewport for a popup
 * positioned via `position: fixed` — same basis the anchor's own
 * `getBoundingClientRect()`-based screen coordinates already assume. Read
 * fresh on every call (not memoized) since a real browser resize is
 * exactly the case a stale cached value would get wrong. */
function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Episode 22, Story 22.3 — canvas mode's node-anchored popup, feeding the
 * SAME `DetailPanel`/`computePopupPosition` a correct position: only
 * `CanvasPlanGraph` owns the live pan/zoom `transform` and the canvas
 * element's own bounding rect needed to compute it (see that component's
 * `onSelectedNodeScreenAnchorChange`). */
function CanvasNodeDetailPopup({
  node,
  context,
  onClose,
  anchor,
}: {
  node: PlanNode
  context: PlanContext
  onClose: () => void
  anchor: { x: number; y: number; width: number; height: number }
}) {
  const position = computePopupPosition(anchor, POPUP_ESTIMATED_SIZE, viewportSize())
  return <DetailPanel node={node} context={context} onClose={onClose} variant="popup" position={position} />
}
