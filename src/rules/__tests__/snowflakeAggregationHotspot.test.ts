import { describe, expect, it } from "vitest"
import { HUGE_INPUT_ROWS_THRESHOLD, LARGE_INPUT_ROWS_THRESHOLD, snowflakeAggregationHotspot, WARNING_OVERALL_PERCENTAGE_THRESHOLD } from "../snowflakeAggregationHotspot"
import { makeContext, makeNode } from "./testHelpers"

function makeAgg(overallPercentage: number, inputRows: number, actualRows?: number) {
  const child = makeNode({ engine: "snowflake", actualRows: inputRows })
  return makeNode({
    engine: "snowflake",
    operatorType: "aggregate",
    actualRows,
    children: [child],
    timeBreakdown: { overallPercentage },
  })
}

describe("snowflakeAggregationHotspot", () => {
  it("fires as info on a large input set with material time share", () => {
    const node = makeAgg(10, LARGE_INPUT_ROWS_THRESHOLD, 100)
    const warnings = snowflakeAggregationHotspot(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("aggregation-hotspot")
    expect(warnings[0].severity).toBe("info")
  })

  it("escalates to warning at extreme input volume AND heavy time share", () => {
    const node = makeAgg(WARNING_OVERALL_PERCENTAGE_THRESHOLD, HUGE_INPUT_ROWS_THRESHOLD, 100)
    expect(snowflakeAggregationHotspot(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("stays info at huge input rows but time share below the warning threshold", () => {
    const node = makeAgg(6, HUGE_INPUT_ROWS_THRESHOLD, 100)
    expect(snowflakeAggregationHotspot(node, makeContext(node))[0].severity).toBe("info")
  })

  it("does not fire below the material time-share threshold", () => {
    const node = makeAgg(1, LARGE_INPUT_ROWS_THRESHOLD, 100)
    expect(snowflakeAggregationHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the large-input-rows threshold, even with material time share", () => {
    const node = makeAgg(50, LARGE_INPUT_ROWS_THRESHOLD - 1, 100)
    expect(snowflakeAggregationHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-aggregate operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "join", actualRows: 100, timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeAggregationHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeAgg(50, LARGE_INPUT_ROWS_THRESHOLD, 100)
    node.engine = "postgres"
    expect(snowflakeAggregationHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not throw when children have no row counts", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "aggregate", actualRows: 5, timeBreakdown: { overallPercentage: 50 }, children: [makeNode({ engine: "snowflake" })] })
    expect(() => snowflakeAggregationHotspot(node, makeContext(node))).not.toThrow()
    expect(snowflakeAggregationHotspot(node, makeContext(node))).toEqual([])
  })

  it("mentions reduction ratio when output rows are known", () => {
    const node = makeAgg(10, LARGE_INPUT_ROWS_THRESHOLD, 1000)
    const longText = snowflakeAggregationHotspot(node, makeContext(node))[0].longText
    expect(longText).toContain("reduction")
  })
})
