import { describe, expect, it } from "vitest"
import { LARGE_INPUT_ROWS_THRESHOLD, snowflakeWindowHotspot, WARNING_OVERALL_PERCENTAGE_THRESHOLD } from "../snowflakeWindowHotspot"
import { makeContext, makeNode } from "./testHelpers"

function makeWindow(overallPercentage: number, inputRows: number) {
  const child = makeNode({ engine: "snowflake", actualRows: inputRows })
  return makeNode({
    engine: "snowflake",
    operatorType: "window_agg",
    children: [child],
    timeBreakdown: { overallPercentage },
  })
}

describe("snowflakeWindowHotspot", () => {
  it("fires as info on a large input set with material time share", () => {
    const node = makeWindow(10, LARGE_INPUT_ROWS_THRESHOLD)
    const warnings = snowflakeWindowHotspot(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("window-hotspot")
    expect(warnings[0].severity).toBe("info")
  })

  it("escalates to warning at heavy time share", () => {
    const node = makeWindow(WARNING_OVERALL_PERCENTAGE_THRESHOLD, LARGE_INPUT_ROWS_THRESHOLD)
    expect(snowflakeWindowHotspot(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("does not fire below the material time-share threshold", () => {
    const node = makeWindow(1, LARGE_INPUT_ROWS_THRESHOLD)
    expect(snowflakeWindowHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the large-input-rows threshold", () => {
    const node = makeWindow(50, LARGE_INPUT_ROWS_THRESHOLD - 1)
    expect(snowflakeWindowHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-window operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "aggregate", actualRows: 100, timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeWindowHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeWindow(50, LARGE_INPUT_ROWS_THRESHOLD)
    node.engine = "postgres"
    expect(snowflakeWindowHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not throw when children have no row counts", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "window_agg", timeBreakdown: { overallPercentage: 50 }, children: [makeNode({ engine: "snowflake" })] })
    expect(() => snowflakeWindowHotspot(node, makeContext(node))).not.toThrow()
    expect(snowflakeWindowHotspot(node, makeContext(node))).toEqual([])
  })

  it("recommends reducing upstream volume, simplifying windows, and examining partition/order keys — never indexing", () => {
    const node = makeWindow(30, LARGE_INPUT_ROWS_THRESHOLD)
    const longText = snowflakeWindowHotspot(node, makeContext(node))[0].longText
    expect(longText).toContain("reducing the row volume")
    expect(longText).toMatch(/simplif(y|ying)/i)
    expect(longText).toContain("partition and order keys")
    expect(longText).not.toMatch(/\badd(ing)? an index\b/i)
    expect(longText).toContain("no index to add")
  })

  it("prefers native inputRows over the max-of-children derivation", () => {
    const child = makeNode({ engine: "snowflake", actualRows: 100 }) // below threshold on its own
    const node = makeNode({
      engine: "snowflake",
      operatorType: "window_agg",
      inputRows: LARGE_INPUT_ROWS_THRESHOLD,
      children: [child],
      timeBreakdown: { overallPercentage: 10 },
    })
    expect(snowflakeWindowHotspot(node, makeContext(node))).toHaveLength(1)
  })
})
