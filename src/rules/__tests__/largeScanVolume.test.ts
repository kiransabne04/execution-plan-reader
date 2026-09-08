import { describe, expect, it } from "vitest"
import { largeScanVolume } from "../largeScanVolume"
import { makeContext, makeNode } from "./testHelpers"

function run(node: ReturnType<typeof makeNode>) {
  return largeScanVolume(node, makeContext(node))
}

function makeScan(overrides: Partial<Parameters<typeof makeNode>[0]> = {}) {
  return makeNode({ engine: "snowflake", operatorType: "seq_scan", rawOperatorLabel: "TableScan", ...overrides })
}

const ONE_GB = 1_073_741_824
const TEN_GB = 10_737_418_240

describe("largeScanVolume", () => {
  it("does NOT fire merely because a scan is large, with no other evidence", () => {
    // Big bytes, but no material runtime and no poor pruning evidence.
    const node = makeScan({ io: { bytesScanned: ONE_GB * 5 }, actualRows: 1_000_000 })
    expect(run(node)).toEqual([])
  })

  it("fires when bytes are large AND runtime share is material", () => {
    const node = makeScan({ io: { bytesScanned: ONE_GB * 2 }, timeBreakdown: { overallPercentage: 25 } })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("large-scan-volume")
  })

  it("fires when bytes are large AND pruning on this same node is poor", () => {
    const node = makeScan({ io: { bytesScanned: ONE_GB * 2 }, pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 } })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].longText).toContain("partition pruning barely narrowed")
  })

  it("does NOT fire below the bytes floor, even with material runtime", () => {
    const node = makeScan({ io: { bytesScanned: 1_000 }, timeBreakdown: { overallPercentage: 90 } })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", io: { bytesScanned: ONE_GB * 2 }, timeBreakdown: { overallPercentage: 50 } })
    expect(run(node)).toEqual([])
  })

  it("escalates to critical above the huge-bytes threshold", () => {
    const warning = run(makeScan({ io: { bytesScanned: ONE_GB * 2 }, timeBreakdown: { overallPercentage: 25 } }))
    expect(warning[0].severity).toBe("warning")

    const critical = run(makeScan({ io: { bytesScanned: TEN_GB + 1 }, timeBreakdown: { overallPercentage: 25 } }))
    expect(critical[0].severity).toBe("critical")
  })

  it("mentions actual rows produced when available", () => {
    const node = makeScan({ io: { bytesScanned: ONE_GB * 2 }, timeBreakdown: { overallPercentage: 25 }, actualRows: 42 })
    expect(run(node)[0].shortText).toContain("42")
  })

  it("never claims size alone is the problem", () => {
    const node = makeScan({ io: { bytesScanned: ONE_GB * 2 }, timeBreakdown: { overallPercentage: 25 } })
    const longText = run(node)[0].longText
    expect(longText).toContain("isn't automatically a problem")
    expect(longText).toContain("doesn't flag scan size in isolation")
  })

  it("does not throw on pathological numeric input", () => {
    for (const bytesScanned of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeScan({ io: { bytesScanned }, timeBreakdown: { overallPercentage: 50 } })
      expect(() => run(node)).not.toThrow()
    }
  })
})
