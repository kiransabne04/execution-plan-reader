import { describe, expect, it } from "vitest"
import { HUGE_RESULT_BYTES_THRESHOLD, LARGE_RESULT_BYTES_THRESHOLD, snowflakeResultTransferBottleneck } from "../snowflakeResultTransferBottleneck"
import { makeContext, makeNode } from "./testHelpers"

function makeResult(bytesWrittenToResult: number, overallPercentage: number) {
  return makeNode({
    engine: "snowflake",
    operatorType: "result",
    io: { bytesWrittenToResult },
    timeBreakdown: { overallPercentage },
  })
}

describe("snowflakeResultTransferBottleneck", () => {
  it("fires as warning at the large-bytes floor with material time share", () => {
    const node = makeResult(LARGE_RESULT_BYTES_THRESHOLD, 10)
    const warnings = snowflakeResultTransferBottleneck(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("result-transfer-bottleneck")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical at the huge-bytes floor", () => {
    const node = makeResult(HUGE_RESULT_BYTES_THRESHOLD, 10)
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("does not fire below the byte floor even with heavy time share", () => {
    const node = makeResult(LARGE_RESULT_BYTES_THRESHOLD - 1, 50)
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toEqual([])
  })

  it("does not fire above the byte floor without material time share", () => {
    const node = makeResult(HUGE_RESULT_BYTES_THRESHOLD, 1)
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toEqual([])
  })

  it("sums bytesWrittenToResult and bytesReadFromResult together", () => {
    const node = makeNode({
      engine: "snowflake",
      operatorType: "result",
      io: { bytesWrittenToResult: LARGE_RESULT_BYTES_THRESHOLD / 2, bytesReadFromResult: LARGE_RESULT_BYTES_THRESHOLD / 2 },
      timeBreakdown: { overallPercentage: 10 },
    })
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire for a non-result operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "aggregate", io: { bytesWrittenToResult: HUGE_RESULT_BYTES_THRESHOLD }, timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeResult(HUGE_RESULT_BYTES_THRESHOLD, 50)
    node.engine = "postgres"
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toEqual([])
  })

  it("does not throw with no io/timeBreakdown data at all", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "result" })
    expect(() => snowflakeResultTransferBottleneck(node, makeContext(node))).not.toThrow()
    expect(snowflakeResultTransferBottleneck(node, makeContext(node))).toEqual([])
  })

  it("recommends selective SELECT/LIMIT/pagination, framed as options not a single prescribed fix", () => {
    const node = makeResult(HUGE_RESULT_BYTES_THRESHOLD, 20)
    const longText = snowflakeResultTransferBottleneck(node, makeContext(node))[0].longText
    expect(longText).toContain("SELECT")
    expect(longText).toContain("LIMIT")
    expect(longText).toContain("paginat")
  })
})
