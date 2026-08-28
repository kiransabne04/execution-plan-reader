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
import { drawGraph } from "./canvasDraw"
import { findNodeAtPoint } from "./hitTest"
import {
  fitTransform,
  screenToWorld,
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
}

const DRAG_THRESHOLD_PX = 4
const WHEEL_ZOOM_IN = 1.08
const WHEEL_ZOOM_OUT = 1 / 1.08

function computeBounds(nodes: PlanGraphNode[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const width = node.width ?? 160
    const height = node.height ?? 56
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }
  return { minX, minY, maxX, maxY }
}

/** Reads a CSS custom property already defined on the ancestor `.plan-
 * graph` element (planGraph.css) rather than hardcoding a color here — the
 * canvas path stays theme-consistent with the DOM/SVG path's own tokens. */
function resolveCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

export function CanvasPlanGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onExpandCollapsedGroup,
}: CanvasPlanGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState<ViewportTransform>(IDENTITY_TRANSFORM)

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
      const textColor = container ? resolveCssVar(container, "--pg-card-text", "#1a1a1a") : "#1a1a1a"
      const selectionColor = container ? resolveCssVar(container, "--pg-canvas-selection", "#1a56db") : "#1a56db"

      drawGraph(ctx, { nodes, edges, transform, selectedNodeId, cssWidth: size.width, cssHeight: size.height, textColor, selectionColor })
    })

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [nodes, edges, transform, selectedNodeId, size, dpr, isVisible])

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
      if (!drag || drag.pointerId !== event.pointerId) return
      const point = getCanvasRelativePoint(event.clientX, event.clientY)
      const dx = point.x - drag.startScreen.x
      const dy = point.y - drag.startScreen.y
      if (!drag.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      drag.dragged = true
      setTransform({ ...drag.startTransform, x: drag.startTransform.x + dx, y: drag.startTransform.y + dy })
    },
    [getCanvasRelativePoint],
  )

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
        onWheel={handleWheel}
      />
    </div>
  )
}
