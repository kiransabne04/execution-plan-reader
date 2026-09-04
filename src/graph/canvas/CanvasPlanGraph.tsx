// Episode 15, Story 15.1 — the canvas rendering path. Takes over from
// React Flow's DOM/SVG path (PlanGraph.tsx) above a node-count threshold.
// dagre layout and the size/color encoding are NOT recomputed here — this
// component only draws what buildGraphElements.ts already produced, and
// hand-builds the interactivity DOM gives away for free: hit-testing,
// pan/zoom, devicePixelRatio scaling, and a redraw-on-change (not
// continuous) render loop. See
// .claude/skills/canvas-rendering-performance/SKILL.md — every rule there
// has a corresponding piece of code below, referenced by number.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react"
import type { PlanGraphEdge, PlanGraphNode } from "../buildGraphElements"
import { buildNodeTooltip } from "../nodeTooltip"
import { drawGraph } from "./canvasDraw"
import { findNodeAtPoint } from "./hitTest"
import { computeBounds } from "./graphBounds"
import { resolveCssVar } from "./cssVars"
import {
  fitTransform,
  panToTransform,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
  IDENTITY_TRANSFORM,
  type ViewportTransform,
} from "./viewportTransform"
import "./canvasPlanGraph.css"

export interface CanvasPlanGraphProps {
  nodes: PlanGraphNode[]
  edges: PlanGraphEdge[]
  selectedNodeId?: string
  onSelectNode: (nodeId: string) => void
  onExpandCollapsedGroup: (parentPlanNodeId: string) => void
  /** Episode 22, Story 22.3 — the selected node's current on-screen
   * bounding rect (viewport-relative pixels, matching `flowToScreenPosition`'s
   * own convention in the DOM/SVG path's `NodeDetailPopup`), or `undefined`
   * when nothing's selected. Recomputed via `worldToScreen` + the canvas
   * element's own `getBoundingClientRect()` in a dedicated effect below,
   * keyed on `transform` — so it fires again on every pan/drag/wheel-zoom
   * tick, not just once at click time. That's the whole mechanism behind
   * this story's own "live-repositions during pan/zoom" requirement: the
   * PARENT (`PlanGraph.tsx`) just re-renders the popup at whatever anchor
   * this reports, the same "derive from current state on every render, no
   * separate tracking loop" idea `NodeDetailPopup` already uses for
   * DOM/SVG mode. Optional and additive — omitting it changes nothing
   * about this component's own behavior (existing `panel`-mode callers
   * never pass it). */
  onSelectedNodeScreenAnchorChange?: (anchor: { x: number; y: number; width: number; height: number } | undefined) => void
  /** Episode 26, Story 26.1 — "jump to this node" (guided walkthrough step
   * advance, Findings/Issues "jump to node," search-palette result
   * selection, comparison-view synced pan) now that canvas is the only
   * rendering path. Mirrors `focusNodeId`/`onFocusHandled`'s own "the
   * caller told me to do something, and I clear it once handled" shape
   * (see PlanGraph.tsx) rather than inventing a second convention. Panning
   * happens at the CURRENT scale (`panToTransform`), never a freshly
   * computed fit scale — jumping to a node must never also change how
   * zoomed in the user is. */
  panToNodeId?: string
  onPanHandled?: () => void
}

const DRAG_THRESHOLD_PX = 4
const WHEEL_ZOOM_IN = 1.08
const WHEEL_ZOOM_OUT = 1 / 1.08

export function CanvasPlanGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onExpandCollapsedGroup,
  onSelectedNodeScreenAnchorChange,
  panToNodeId,
  onPanHandled,
}: CanvasPlanGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<ViewportTransform>(IDENTITY_TRANSFORM)
  // Episode 26, Story 26.1 — hover tooltip (predicate/seek/join condition),
  // canvas mode's replacement for PlanNodeCard's CSS-only `:hover`/
  // `:focus-within` reveal, which disappears along with the rest of DOM/SVG
  // mode. `buildNodeTooltip` is the exact same content function DOM mode
  // used — this only adds a hit-tested equivalent to hovering a real DOM
  // element, not a second tooltip-content implementation. Suppressed once
  // an actual drag (pan) is underway, so panning across nodes doesn't flash
  // tooltips the user isn't asking for. Declared here (ahead of the draw
  // effect below) rather than nearer its own pointer-move handler — Story
  // 26.7 added it to that effect's own dependency array (hover now
  // repaints the hovered card's border, matching the mockup's own
  // `:hover`), and a dependency array is evaluated at the point the effect
  // is declared, so the state it references has to exist by then.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>(undefined)

  // Rule 4 — devicePixelRatio. Read once per render pass rather than
  // cached in state; a DPR change (dragging the window to a different
  // monitor) is rare enough that re-reading it on every size/transform
  // change (already the redraw trigger) is simpler than a dedicated
  // matchMedia listener, and costs nothing extra.
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1

  // Rule 5 — pause when the tab isn't visible. Tracked in state (not just
  // checked inline at draw time) so a redraw is actively re-scheduled the
  // moment the tab becomes visible again, catching up on anything that
  // changed while hidden.
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState !== "hidden"))
  useEffect(() => {
    const handleVisibility = () => setIsVisible(document.visibilityState !== "hidden")
    document.addEventListener("visibilitychange", handleVisibility)
    return () => document.removeEventListener("visibilitychange", handleVisibility)
  }, [])

  // Container size, via ResizeObserver (falls back to whatever the initial
  // synchronous read gives — 0x0 in a real-DOM-less test environment,
  // which every size-dependent calculation below already treats as a
  // valid, non-crashing degenerate case rather than a special case).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fit-to-view whenever the node SET changes shape (mirrors PlanGraph's
  // own fitView effect, keyed the same way — on nodes.length, not node
  // identity, so panning/zooming manually doesn't get silently undone by
  // an unrelated re-render).
  useEffect(() => {
    const bounds = computeBounds(nodes)
    if (!bounds || size.width <= 0 || size.height <= 0) return
    setTransform(fitTransform(bounds, size, { padding: 0.1 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, size.width, size.height])

  // Episode 26, Story 26.1 — pan-to-node. Runs whenever the caller sets
  // `panToNodeId`; centers that single node's own bounds at the CURRENT
  // scale (never a fit-computed one — see this prop's own doc comment),
  // then immediately tells the caller it's been handled, mirroring
  // `focusNodeId`'s exact "consume once, then clear" contract in
  // PlanGraph.tsx. A node id that isn't (or isn't yet) in `nodes` — e.g.
  // still hidden inside a collapsed group the caller hasn't expanded yet —
  // is silently skipped rather than throwing; the caller is expected to
  // expand collapsed groups first (PlanGraph.tsx's `focusNodeId` effect
  // already does this before ever setting `panToNodeId`).
  useEffect(() => {
    if (panToNodeId === undefined) return
    const node = nodes.find((n) => n.id === panToNodeId)
    // Not (yet) in `nodes` — still behind a collapsed ancestor the caller
    // just asked to expand (PlanGraph.tsx's `focusNodeId` effect). That
    // expansion lands on a LATER `nodes` update, which re-runs this same
    // effect (it's in the dep array below) — wait for it rather than
    // consuming `panToNodeId` now and silently never panning at all.
    if (!node) return
    if (size.width > 0 && size.height > 0) {
      const bounds = computeBounds([node])
      if (bounds) setTransform((prev) => panToTransform(bounds, size, prev.scale))
    }
    onPanHandled?.()
  }, [panToNodeId, nodes, size, onPanHandled])

  // Rule 3 — redraw only on change, batched via requestAnimationFrame, not
  // fired synchronously per state update or on a timer/interval. Every
  // input that should visually change the canvas funnels through this one
  // effect; the actual `ctx.draw*` calls only ever happen inside the
  // scheduled frame callback, never inline in an event handler.
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isVisible) return // paused (rule 5) — the effect re-runs and catches up once isVisible flips back
    const canvas = canvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const ctx = canvas.getContext("2d")
      // A null context (unsupported environment, or a browser that's
      // already handed out a different context type for this element) is
      // a real possibility, not just a test-environment artifact — draw
      // is simply skipped, never a thrown error.
      if (!ctx) return

      canvas.width = size.width * dpr
      canvas.height = size.height * dpr
      canvas.style.width = `${size.width}px`
      canvas.style.height = `${size.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const container = containerRef.current
      // Episode 18, Story 18.1: fallbacks below match src/styles/tokens.css's
      // dark-only palette — this app has no light mode to fall back to.
      const textColor = container ? resolveCssVar(container, "--pg-card-text", "#e9e9ed") : "#e9e9ed"
      const selectionColor = container ? resolveCssVar(container, "--pg-canvas-selection", "#b5abfc") : "#b5abfc"
      // Episode 26, Story 26.7 — flat, neutral node-card chrome matching
      // the reference mockup: fill from `--pg-card-bg` (already an alias
      // for `--color-surface`), border from the STRONGER `--color-border-
      // strong` (not the fainter `--pg-card-border`/`--color-border` used
      // for other chrome dividers — the mockup's own node border is
      // visibly stronger than that), hover border from `--color-accent`.
      const nodeSurfaceColor = container ? resolveCssVar(container, "--pg-card-bg", "#232532") : "#232532"
      const nodeBorderColor = container ? resolveCssVar(container, "--color-border-strong", "#3f424d") : "#3f424d"
      const nodeAccentColor = container ? resolveCssVar(container, "--color-accent", "#9184d9") : "#9184d9"
      const badgeNeutralBg = container ? resolveCssVar(container, "--color-border", "rgba(233, 233, 237, 0.12)") : "rgba(233, 233, 237, 0.12)"
      // Episode 14, Story 14.2 — cheap to resolve unconditionally (same
      // handful of getComputedStyle reads as the two colors above); a plain
      // single-plan render simply never has any node carrying a
      // comparisonOverlay, so these values go unused rather than needing a
      // separate "is this a comparison view" flag threaded through here.
      const comparisonColors = container
        ? {
            changed: resolveCssVar(container, "--pg-comparison-changed", "#f79009"),
            addedInB: resolveCssVar(container, "--pg-comparison-added", "#47cd89"),
            removedFromB: resolveCssVar(container, "--pg-comparison-removed", "#b692f6"),
          }
        : undefined
      // Episode 18, Story 18.4 — spec §4's two edge stroke colors and §3's
      // severity-ring colors, resolved the same way as every other token
      // this component reads.
      const edgeColors = {
        hot: container ? resolveCssVar(container, "--color-edge-hot", "#8d6a6a") : "#8d6a6a",
        muted: container ? resolveCssVar(container, "--color-edge-muted", "#6b6f82") : "#6b6f82",
      }
      const severityColors = {
        critical: container ? resolveCssVar(container, "--color-critical", "#f97066") : "#f97066",
        warning: container ? resolveCssVar(container, "--color-warning", "#f79009") : "#f79009",
      }

      drawGraph(ctx, {
        nodes,
        edges,
        transform,
        selectedNodeId,
        hoveredNodeId,
        edgeColors,
        severityColors,
        cssWidth: size.width,
        cssHeight: size.height,
        textColor,
        selectionColor,
        nodeSurfaceColor,
        nodeBorderColor,
        nodeAccentColor,
        badgeNeutralBg,
        comparisonColors,
      })
    })

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [nodes, edges, transform, selectedNodeId, hoveredNodeId, size, dpr, isVisible])

  // Episode 22, Story 22.3 — reports the selected node's live on-screen
  // anchor outward (see this prop's own doc comment). Deliberately its own
  // effect, not folded into the draw effect above: this is cheap arithmetic
  // that should run every time `transform` changes (including mid-drag,
  // every `handlePointerMove` tick), not batched behind a
  // requestAnimationFrame the way the actual `ctx.draw*` calls are (Rule 3
  // is about avoiding EXPENSIVE redundant canvas work, not about this).
  useEffect(() => {
    if (!onSelectedNodeScreenAnchorChange) return
    const node = selectedNodeId !== undefined ? nodes.find((n) => n.id === selectedNodeId) : undefined
    if (!node) {
      onSelectedNodeScreenAnchorChange(undefined)
      return
    }
    // Same two-step composition React Flow's own `flowToScreenPosition`
    // does internally (viewportTransform.ts's own doc comment on
    // `worldToScreen`): the pure world-to-canvas-local math, then adding
    // the canvas element's own `getBoundingClientRect()` offset to land on
    // true viewport-relative coordinates — `position: fixed` popup styling
    // needs the latter, not the former.
    const rect = canvasRef.current?.getBoundingClientRect()
    const width = node.width ?? 160
    const height = node.height ?? 56
    const local = worldToScreen(node.position, transform)
    const anchor = {
      x: local.x + (rect?.left ?? 0),
      y: local.y + (rect?.top ?? 0),
      width: width * transform.scale,
      height: height * transform.scale,
    }
    // Defensive guard (this file's own numeric-edge-case discipline, Rule
    // 3's sibling concern): an extreme zoom or a node far from the world
    // origin should degrade to "no popup this frame," never a NaN/Infinity
    // reaching the DOM as an inline style.
    if (![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)) {
      onSelectedNodeScreenAnchorChange(undefined)
      return
    }
    onSelectedNodeScreenAnchorChange(anchor)
  }, [selectedNodeId, transform, nodes, onSelectedNodeScreenAnchorChange])

  // Pointer interaction: drag-to-pan, and a click (movement below the drag
  // threshold) resolves via hit-testing (rule 2) rather than any DOM event
  // target — canvas has exactly one element for every node, so this is the
  // ONLY way a click maps to a specific plan node.
  const dragState = useRef<{ pointerId: number; startScreen: { x: number; y: number }; startTransform: ViewportTransform; dragged: boolean } | null>(null)

  const getCanvasRelativePoint = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      dragState.current = {
        pointerId: event.pointerId,
        startScreen: getCanvasRelativePoint(event.clientX, event.clientY),
        startTransform: transform,
        dragged: false,
      }
      // Feature-detected, not assumed: pointer capture isn't universally
      // implemented (older/embedded browsers, and this codebase's own
      // jsdom test environment) — its absence should degrade to "no
      // capture" gracefully, never a thrown error that breaks the drag.
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [transform, getCanvasRelativePoint],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const drag = dragState.current
      if (drag && drag.pointerId === event.pointerId) {
        const point = getCanvasRelativePoint(event.clientX, event.clientY)
        const dx = point.x - drag.startScreen.x
        const dy = point.y - drag.startScreen.y
        if (!drag.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          // still within the click-vs-drag threshold — fall through to the
          // hover hit-test below, same as a plain hover move.
        } else {
          drag.dragged = true
          setTransform({ ...drag.startTransform, x: drag.startTransform.x + dx, y: drag.startTransform.y + dy })
          setHoveredNodeId(undefined)
          return
        }
      }
      const worldPoint = screenToWorld(getCanvasRelativePoint(event.clientX, event.clientY), transform)
      const hit = findNodeAtPoint(nodes, worldPoint)
      setHoveredNodeId(hit && hit.data.kind === "plan" ? hit.id : undefined)
    },
    [nodes, transform, getCanvasRelativePoint],
  )

  const handlePointerLeave = useCallback(() => setHoveredNodeId(undefined), [])

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const drag = dragState.current
      dragState.current = null
      if (!drag || drag.pointerId !== event.pointerId) return
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      if (drag.dragged) return // a pan gesture, not a click

      const screenPoint = getCanvasRelativePoint(event.clientX, event.clientY)
      const worldPoint = screenToWorld(screenPoint, transform)
      const hit = findNodeAtPoint(nodes, worldPoint)
      if (!hit) return
      if (hit.data.kind === "collapsed-group") {
        onExpandCollapsedGroup(hit.data.parentPlanNodeId)
      } else {
        onSelectNode(hit.id)
      }
    },
    [nodes, transform, getCanvasRelativePoint, onSelectNode, onExpandCollapsedGroup],
  )

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const point = getCanvasRelativePoint(event.clientX, event.clientY)
      setTransform((prev) => zoomAtPoint(prev, point, event.deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT))
    },
    [getCanvasRelativePoint],
  )

  const hoveredNode = hoveredNodeId !== undefined ? nodes.find((n) => n.id === hoveredNodeId) : undefined
  const hoveredTooltip =
    hoveredNode && hoveredNode.data.kind === "plan" ? buildNodeTooltip(hoveredNode.data.planNode) : undefined
  const hoveredAnchor = hoveredNode
    ? (() => {
        const rect = canvasRef.current?.getBoundingClientRect()
        const local = worldToScreen(hoveredNode.position, transform)
        const width = (hoveredNode.width ?? 160) * transform.scale
        const x = local.x + (rect?.left ?? 0) + width / 2
        const y = local.y + (rect?.top ?? 0)
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
      })()
    : undefined

  return (
    <div ref={containerRef} className="canvas-plan-graph" data-testid="canvas-plan-graph">
      {/* aria-hidden: this canvas is a visual-only surface for mouse/
          trackpad users. AccessiblePlanList (rendered alongside this by
          PlanGraph.tsx, sharing the same selection state) is the real
          interactive surface for keyboard and screen-reader users — see
          Story 15.2 and the skill's "Accessibility is required" section. */}
      <canvas
        ref={canvasRef}
        data-testid="canvas-plan-graph-surface"
        aria-hidden="true"
        role="presentation"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />
      {hoveredTooltip && hoveredAnchor && (
        <div
          className="canvas-plan-graph__tooltip"
          data-testid="canvas-plan-graph-tooltip"
          role="tooltip"
          style={{ left: `${hoveredAnchor.x}px`, top: `${hoveredAnchor.y}px` }}
        >
          {hoveredTooltip}
        </div>
      )}
    </div>
  )
}
