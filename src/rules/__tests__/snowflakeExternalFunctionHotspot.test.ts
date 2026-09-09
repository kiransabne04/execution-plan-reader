import { describe, expect, it } from "vitest"
import { LARGE_INPUT_ROWS_THRESHOLD, snowflakeExternalFunctionHotspot, WARNING_OVERALL_PERCENTAGE_THRESHOLD } from "../snowflakeExternalFunctionHotspot"
import { makeContext, makeNode } from "./testHelpers"

function makeExternalFn(overallPercentage: number, inputRows: number) {
  const child = makeNode({ engine: "snowflake", actualRows: inputRows })
  return makeNode({
    engine: "snowflake",
    operatorType: "external_function",
    children: [child],
    timeBreakdown: { overallPercentage },
  })
}

describe("snowflakeExternalFunctionHotspot", () => {
  it("fires as info on a large input set with material time share", () => {
    const node = makeExternalFn(10, LARGE_INPUT_ROWS_THRESHOLD)
    const warnings = snowflakeExternalFunctionHotspot(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("external-function-hotspot")
    expect(warnings[0].severity).toBe("info")
  })

  it("escalates to warning at heavy time share", () => {
    const node = makeExternalFn(WARNING_OVERALL_PERCENTAGE_THRESHOLD, LARGE_INPUT_ROWS_THRESHOLD)
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("does not fire below the material time-share threshold", () => {
    const node = makeExternalFn(1, LARGE_INPUT_ROWS_THRESHOLD)
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the large-input-rows threshold — a single round-trip's fixed latency isn't a signal", () => {
    const node = makeExternalFn(50, LARGE_INPUT_ROWS_THRESHOLD - 1)
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-external-function operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "aggregate", actualRows: 100, timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeExternalFn(50, LARGE_INPUT_ROWS_THRESHOLD)
    node.engine = "postgres"
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not throw when children have no row counts", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "external_function", timeBreakdown: { overallPercentage: 50 }, children: [makeNode({ engine: "snowflake" })] })
    expect(() => snowflakeExternalFunctionHotspot(node, makeContext(node))).not.toThrow()
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toEqual([])
  })

  it("stays honest about not having invocation-count/latency data, never fabricating it", () => {
    const node = makeExternalFn(30, LARGE_INPUT_ROWS_THRESHOLD)
    const longText = snowflakeExternalFunctionHotspot(node, makeContext(node))[0].longText
    expect(longText).toContain("doesn't currently capture")
    expect(longText).not.toMatch(/\d+ invocations|latency percentile|p\d\d latency/i)
  })

  it("prefers native inputRows over the max-of-children derivation", () => {
    const child = makeNode({ engine: "snowflake", actualRows: 100 }) // below threshold on its own
    const node = makeNode({
      engine: "snowflake",
      operatorType: "external_function",
      inputRows: LARGE_INPUT_ROWS_THRESHOLD,
      children: [child],
      timeBreakdown: { overallPercentage: 10 },
    })
    expect(snowflakeExternalFunctionHotspot(node, makeContext(node))).toHaveLength(1)
  })
})
