import { describe, expect, it } from "vitest"
import { clampScale, fitTransform, screenToWorld, zoomAtPoint, IDENTITY_TRANSFORM, MIN_SCALE, MAX_SCALE } from "../viewportTransform"

describe("clampScale", () => {
  it("clamps below MIN_SCALE and above MAX_SCALE", () => {
    expect(clampScale(0)).toBe(MIN_SCALE)
    expect(clampScale(-5)).toBe(MIN_SCALE)
    expect(clampScale(100)).toBe(MAX_SCALE)
  })

  it("passes through an in-range value unchanged", () => {
    expect(clampScale(1)).toBe(1)
  })
})

describe("screenToWorld", () => {
  it("is the identity at the identity transform", () => {
    expect(screenToWorld({ x: 50, y: 80 }, IDENTITY_TRANSFORM)).toEqual({ x: 50, y: 80 })
  })

  it("accounts for pan offset", () => {
    expect(screenToWorld({ x: 110, y: 60 }, { x: 100, y: 50, scale: 1 })).toEqual({ x: 10, y: 10 })
  })

  it("accounts for scale", () => {
    expect(screenToWorld({ x: 200, y: 100 }, { x: 0, y: 0, scale: 2 })).toEqual({ x: 100, y: 50 })
  })

  it("accounts for pan and scale together", () => {
    expect(screenToWorld({ x: 220, y: 120 }, { x: 20, y: 20, scale: 2 })).toEqual({ x: 100, y: 50 })
  })
})

describe("zoomAtPoint", () => {
  it("the screen point maps to the same world point before and after zooming (zoom-toward-cursor)", () => {
    const start = { x: 30, y: 40, scale: 1 }
    const screenPoint = { x: 300, y: 200 }
    const worldBefore = screenToWorld(screenPoint, start)

    const next = zoomAtPoint(start, screenPoint, 1.5)
    const worldAfter = screenToWorld(screenPoint, next)

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6)
    expect(next.scale).toBeCloseTo(1.5, 6)
  })

  it("clamps the resulting scale", () => {
    const next = zoomAtPoint({ x: 0, y: 0, scale: MAX_SCALE }, { x: 0, y: 0 }, 10)
    expect(next.scale).toBe(MAX_SCALE)
  })
})

describe("fitTransform", () => {
  it("centers the bounds in the viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const t = fitTransform(bounds, { width: 400, height: 400 }, { padding: 0 })
    const worldCenter = screenToWorld({ x: 200, y: 200 }, t)
    expect(worldCenter.x).toBeCloseTo(50, 4)
    expect(worldCenter.y).toBeCloseTo(50, 4)
  })

  it("never exceeds maxScale even for tiny bounds in a huge viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const t = fitTransform(bounds, { width: 2000, height: 2000 }, { maxScale: 2 })
    expect(t.scale).toBeLessThanOrEqual(2)
  })

  it("shrinks scale to fit large bounds into a small viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }
    const t = fitTransform(bounds, { width: 400, height: 400 })
    expect(t.scale).toBeLessThan(1)
  })

  it("does not throw or produce NaN for a degenerate (zero-size) viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const t = fitTransform(bounds, { width: 0, height: 0 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.x)).toBe(true)
    expect(Number.isFinite(t.y)).toBe(true)
  })

  it("does not throw or produce NaN for degenerate (zero-area) bounds", () => {
    const bounds = { minX: 50, minY: 50, maxX: 50, maxY: 50 }
    const t = fitTransform(bounds, { width: 400, height: 400 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.x)).toBe(true)
    expect(Number.isFinite(t.y)).toBe(true)
  })
})
