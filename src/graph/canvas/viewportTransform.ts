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

  const boundsCenterX = (bounds.minX + bounds.maxX) / 2
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2

  return {
    scale,
    x: viewport.width / 2 - boundsCenterX * scale,
    y: viewport.height / 2 - boundsCenterY * scale,
  }
}
