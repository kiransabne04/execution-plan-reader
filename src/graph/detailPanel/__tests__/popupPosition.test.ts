import { describe, expect, it } from "vitest"
import { computePopupPosition, POPUP_ANCHOR_GAP, type Rect, type Size } from "../popupPosition"

const VIEWPORT: Size = { width: 1200, height: 800 }
const POPUP_SIZE: Size = { width: 360, height: 300 }

function node(x: number, y: number, width = 160, height = 56): Rect {
  return { x, y, width, height }
}

describe("computePopupPosition", () => {
  it("defaults to the right of the node, top-aligned with its top edge, when there's room", () => {
    const result = computePopupPosition(node(100, 100), POPUP_SIZE, VIEWPORT)
    expect(result).toEqual({
      left: 100 + 160 + POPUP_ANCHOR_GAP,
      top: 100,
      flippedHorizontal: false,
      flippedVertical: false,
    })
  })

  it("flips to the LEFT of the node — away from the edge it's near — when the right edge would overflow", () => {
    // node's right edge sits close to the viewport's own right edge
    const result = computePopupPosition(node(1100, 100), POPUP_SIZE, VIEWPORT)
    expect(result.flippedHorizontal).toBe(true)
    expect(result.left).toBe(1100 - POPUP_ANCHOR_GAP - POPUP_SIZE.width)
    // never renders anywhere past the node's own left edge in this case
    expect(result.left).toBeLessThan(1100)
  })

  it("flips to bottom-aligned — away from the bottom edge — when top-aligned would overflow", () => {
    const result = computePopupPosition(node(100, 700), POPUP_SIZE, VIEWPORT)
    expect(result.flippedVertical).toBe(true)
    expect(result.top).toBe(700 + 56 - POPUP_SIZE.height)
    expect(result.top).toBeLessThan(700)
  })

  it("does NOT flip near the left edge — the default (rightward) placement already stays away from it", () => {
    const result = computePopupPosition(node(0, 100), POPUP_SIZE, VIEWPORT)
    expect(result.flippedHorizontal).toBe(false)
    expect(result.left).toBe(0 + 160 + POPUP_ANCHOR_GAP)
  })

  it("does NOT flip near the top edge — the default (top-aligned) placement already stays away from it", () => {
    const result = computePopupPosition(node(100, 0), POPUP_SIZE, VIEWPORT)
    expect(result.flippedVertical).toBe(false)
    expect(result.top).toBe(0)
  })

  it("flips BOTH ways for a node near the bottom-right corner", () => {
    const result = computePopupPosition(node(1100, 750), POPUP_SIZE, VIEWPORT)
    expect(result.flippedHorizontal).toBe(true)
    expect(result.flippedVertical).toBe(true)
    expect(result.left + POPUP_SIZE.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(result.top + POPUP_SIZE.height).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it("stays fully on-screen for a node near the top-left corner (no flips needed)", () => {
    const result = computePopupPosition(node(0, 0), POPUP_SIZE, VIEWPORT)
    expect(result.flippedHorizontal).toBe(false)
    expect(result.flippedVertical).toBe(false)
    expect(result.left).toBeGreaterThanOrEqual(0)
    expect(result.top).toBeGreaterThanOrEqual(0)
  })

  it("clamps to the origin, never a negative position, when the popup is larger than the viewport itself", () => {
    const tinyViewport: Size = { width: 300, height: 200 }
    const result = computePopupPosition(node(50, 50), POPUP_SIZE, tinyViewport)
    expect(result.left).toBe(0)
    expect(result.top).toBe(0)
  })

  it("every returned position is finite — no NaN/Infinity leaking from degenerate zero-size input", () => {
    const result = computePopupPosition(node(0, 0, 0, 0), { width: 0, height: 0 }, VIEWPORT)
    expect(Number.isFinite(result.left)).toBe(true)
    expect(Number.isFinite(result.top)).toBe(true)
  })
})
