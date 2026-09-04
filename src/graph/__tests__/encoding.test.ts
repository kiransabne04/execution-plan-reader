import { describe, expect, it } from "vitest"
import {
  EDGE_WIDTH_RANGE,
  NODE_HEIGHT_RANGE,
  NODE_WIDTH_RANGE,
  buildEdgeWidthScale,
  buildMetricScale,
  pickMetricValue,
} from "../encoding"
import { makeNode } from "../../rules/__tests__/testHelpers"

describe("pickMetricValue", () => {
  it("prefers actualTimeMs, falling back through cost/rows, when metric is actualTimeMs", () => {
    expect(pickMetricValue(makeNode({ actualTimeMs: 5, estimatedCost: 10 }), "actualTimeMs")).toBe(5)
    expect(pickMetricValue(makeNode({ estimatedCost: 10 }), "actualTimeMs")).toBe(10)
    expect(pickMetricValue(makeNode({ actualRows: 7 }), "actualTimeMs")).toBe(7)
  })

  it("floors negative/NaN/undefined to 0 rather than producing a degenerate value", () => {
    expect(pickMetricValue(makeNode({}), "actualTimeMs")).toBe(0)
    expect(pickMetricValue(makeNode({ actualTimeMs: Number.NaN }), "actualTimeMs")).toBe(0)
    expect(pickMetricValue(makeNode({ actualTimeMs: -5 }), "actualTimeMs")).toBe(0)
  })
})

describe("buildMetricScale", () => {
  it("assigns min size to a zero-metric node without dividing by zero", () => {
    const root = makeNode({ actualTimeMs: 0 })
    const scale = buildMetricScale(root, "actualTimeMs")
    expect(scale.maxValue).toBe(0)
    const size = scale.sizeFor(0)
    expect(size.width).toBe(NODE_WIDTH_RANGE.min)
    expect(size.height).toBe(NODE_HEIGHT_RANGE.min)
  })

  it("scales the max-value node to the top of the range and a small node near the bottom", () => {
    const small = makeNode({ id: "small", actualTimeMs: 1 })
    const big = makeNode({ id: "big", actualTimeMs: 1000 })
    const root = makeNode({ id: "root", actualTimeMs: 0, children: [small, big] })
    const scale = buildMetricScale(root, "actualTimeMs")
    expect(scale.sizeFor(1000).width).toBe(NODE_WIDTH_RANGE.max)
    expect(scale.sizeFor(1).width).toBeLessThan(scale.sizeFor(1000).width)
    expect(scale.sizeFor(1).width).toBeGreaterThanOrEqual(NODE_WIDTH_RANGE.min)
  })

  it("never produces a width/height outside the documented range", () => {
    const root = makeNode({ actualTimeMs: 42 })
    const scale = buildMetricScale(root, "actualTimeMs")
    for (const v of [0, 1, 42, 1e9, Number.NaN, -5]) {
      const { width, height } = scale.sizeFor(v)
      expect(width).toBeGreaterThanOrEqual(NODE_WIDTH_RANGE.min)
      expect(width).toBeLessThanOrEqual(NODE_WIDTH_RANGE.max)
      expect(height).toBeGreaterThanOrEqual(NODE_HEIGHT_RANGE.min)
      expect(height).toBeLessThanOrEqual(NODE_HEIGHT_RANGE.max)
    }
  })
})

describe("buildEdgeWidthScale", () => {
  it("floors zero/negative/missing rows to the minimum edge width", () => {
    const root = makeNode({ actualRows: 1000 })
    const scale = buildEdgeWidthScale(root)
    expect(scale.widthFor(0)).toBe(EDGE_WIDTH_RANGE.min)
    expect(scale.widthFor(-5)).toBe(EDGE_WIDTH_RANGE.min)
    expect(scale.widthFor(Number.NaN)).toBe(EDGE_WIDTH_RANGE.min)
  })

  it("scales up to the max width range for the highest row count in the tree", () => {
    const child = makeNode({ id: "c", actualRows: 5000 })
    const root = makeNode({ id: "r", actualRows: 0, children: [child] })
    const scale = buildEdgeWidthScale(root)
    expect(scale.widthFor(5000)).toBe(EDGE_WIDTH_RANGE.max)
  })
})
