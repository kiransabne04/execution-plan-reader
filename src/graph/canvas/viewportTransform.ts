// Episode 15, Story 15.1 — pan/zoom transform math for the canvas path.
// Kept as plain, framework-free functions (no React, no canvas context)
// so pointer-coordinate conversion is unit-testable without a real canvas.

export interface ViewportTransform {
  /** Pan offset, in CSS pixels — the world-space origin's screen position. */
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 2

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export const IDENTITY_TRANSFORM: ViewportTransform = { x: 0, y: 0, scale: 1 }

/** A screen coordinate (CSS pixels, relative to the canvas element's own
 * top-left — i.e. already adjusted for `getBoundingClientRect()`) to the
 * corresponding world/graph coordinate under the current transform. This is
 * what hit-testing needs: dagre's layout lives in world space. */
export function screenToWorld(screen: { x: number; y: number }, transform: ViewportTransform): { x: number; y: number } {
  return {
    x: (screen.x - transform.x) / transform.scale,
    y: (screen.y - transform.y) / transform.scale,
  }
}

/** Episode 22, Story 22.3 — the exact inverse of `screenToWorld` above:
 * a world/graph coordinate to its current on-screen (canvas-local, same
 * "relative to the canvas element's own top-left" convention as
 * `screenToWorld`'s own input) position. This is what the node-anchored
 * detail popup needs: `screenToWorld` turns a click into "which node did
 * you hit," `worldToScreen` turns a hit node's own position back into
 * "where should the popup that describes it render." */
export function worldToScreen(world: { x: number; y: number }, transform: ViewportTransform): { x: number; y: number } {
  return {
    x: world.x * transform.scale + transform.x,
    y: world.y * transform.scale + transform.y,
  }
}

/** Zoom around a fixed screen point (e.g. the cursor) rather than the
 * canvas origin — standard "zoom toward where you're pointing" behavior,
 * without which every zoom step would visibly recenter the view. */
export function zoomAtPoint(
  transform: ViewportTransform,
  screenPoint: { x: number; y: number },
  scaleFactor: number,
): ViewportTransform {
  const nextScale = clampScale(transform.scale * scaleFactor)
  const worldPoint = screenToWorld(screenPoint, transform)
  return {
    scale: nextScale,
    x: screenPoint.x - worldPoint.x * nextScale,
    y: screenPoint.y - worldPoint.y * nextScale,
  }
}

/** The shared centering math both `fitTransform` and `centerAt` below build
 * on: given a chosen `scale`, the pan offset that puts `bounds`'s own
 * center at the viewport's center. Pulled out on its own (Episode 26, Story
 * 26.1) so pan-to-node can reuse the EXACT same formula at a caller-supplied
 * fixed scale, rather than fitTransform's own freshly-computed fit scale. */
function centerAt(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  scale: number,
): ViewportTransform {
  const boundsCenterX = (bounds.minX + bounds.maxX) / 2
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2
  return {
    scale,
    x: viewport.width / 2 - boundsCenterX * scale,
    y: viewport.height / 2 - boundsCenterY * scale,
  }
}

/** Computes a transform that fits `bounds` (world-space) inside a
 * `viewport` (CSS-pixel width/height) with the given padding fraction on
 * each side, capped at `maxScale` — mirrors the DOM/SVG path's fitView,
 * so a large plan doesn't render pre-zoomed past legibility here either. */
export function fitTransform(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  options: { padding?: number; maxScale?: number } = {},
): ViewportTransform {
  const padding = options.padding ?? 0.1
  const maxScale = options.maxScale ?? MAX_SCALE
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX)
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY)

  const availableWidth = viewport.width * (1 - padding * 2)
  const availableHeight = viewport.height * (1 - padding * 2)
  const scale = clampScale(Math.min(maxScale, availableWidth / boundsWidth, availableHeight / boundsHeight))

  return centerAt(bounds, viewport, scale)
}

/** Episode 26, Story 26.1 — pans to center `bounds` in `viewport` at a FIXED
 * scale (the caller's current zoom level), never a freshly fit-computed one.
 * This is what every "jump to this node" caller (guided walkthrough, the
 * Findings/Issues list, the search palette, comparison-view synced
 * selection) needs: recentering on a node must never also silently change
 * how zoomed in the user currently is. Reuses `centerAt`'s exact centering
 * formula — the only thing pan-to-node does differently from `fitTransform`
 * is which scale it centers at. */
export function panToTransform(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: { width: number; height: number },
  currentScale: number,
): ViewportTransform {
  return centerAt(bounds, viewport, clampScale(currentScale))
}
