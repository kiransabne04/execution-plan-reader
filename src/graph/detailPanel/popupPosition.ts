// Episode 22, Story 22.2 — pure, framework-free positioning math for the
// node-anchored detail popup, mirroring viewportTransform.ts's own
// "no DOM/no canvas, just numbers" testing style. Takes the clicked node's
// on-screen rectangle (already computed by the caller — DOM/SVG mode via
// React Flow's `flowToScreenPosition()`, canvas mode via Story 22.3's own
// `worldToScreen()`) and the current viewport size, and returns where the
// popup should render so it never clips off-screen.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PopupPosition {
  left: number
  top: number
  /** Whether the popup rendered on the opposite side of its default
   * placement (right of the node) because the default would have overflowed
   * the right edge — exposed mainly for tests to assert the "flip away from
   * the edge it's near" behavior explicitly, not just the resulting numbers. */
  flippedHorizontal: boolean
  /** Same idea, for the default top-aligned-with-the-node placement
   * flipping to bottom-aligned when it would overflow the bottom edge. */
  flippedVertical: boolean
}

/** Gap between the node's edge and the popup, in the same pixel units as
 * every rect/size passed in — matches the small breathing room a well-
 * behaved tooltip/dropdown leaves, not flush against the node it's about. */
export const POPUP_ANCHOR_GAP = 12

function clamp(value: number, min: number, max: number): number {
  // `max` can be < `min` when the popup is larger than the viewport itself
  // (a tiny embedded iframe, an extreme browser zoom) — clamping to `min`
  // (0) in that case is the honest "give up gracefully" answer: the popup
  // renders flush against the origin rather than at a nonsensical negative
  // or NaN position.
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Default placement is to the RIGHT of the node, top-aligned with its top
 * edge — flips to the LEFT when that would overflow the viewport's right
 * edge, and flips to bottom-aligned when top-aligned would overflow the
 * bottom edge. Both flips are evaluated independently (a node near the
 * bottom-right corner flips both ways at once). A final clamp is the
 * last-resort safety net for the case neither placement fully fits (the
 * popup itself is wider/taller than the viewport) — it keeps the result a
 * real, on-screen (if imperfectly placed) number rather than letting it run
 * off either edge.
 */
export function computePopupPosition(anchor: Rect, popupSize: Size, viewport: Size, gap: number = POPUP_ANCHOR_GAP): PopupPosition {
  const fitsRight = anchor.x + anchor.width + gap + popupSize.width <= viewport.width
  const left = fitsRight ? anchor.x + anchor.width + gap : anchor.x - gap - popupSize.width
  const flippedHorizontal = !fitsRight

  const fitsTopAligned = anchor.y + popupSize.height <= viewport.height
  const top = fitsTopAligned ? anchor.y : anchor.y + anchor.height - popupSize.height
  const flippedVertical = !fitsTopAligned

  return {
    left: clamp(left, 0, viewport.width - popupSize.width),
    top: clamp(top, 0, viewport.height - popupSize.height),
    flippedHorizontal,
    flippedVertical,
  }
}
