import { describe, expect, it } from "vitest"
import { poorPartitionPruning } from "../poorPartitionPruning"
import { makeContext, makeNode } from "./testHelpers"

function run(node: ReturnType<typeof makeNode>) {
  return poorPartitionPruning(node, makeContext(node))
}

function makeScan(pruning: { partitionsScanned?: number; partitionsTotal?: number }) {
  return makeNode({ engine: "snowflake", operatorType: "seq_scan", rawOperatorLabel: "TableScan", pruning })
}

describe("poorPartitionPruning", () => {
  it("fires on the story's own high-concern example: 9800/10000 scanned", () => {
    const warnings = run(makeScan({ partitionsScanned: 9_800, partitionsTotal: 10_000 }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("poor-partition-pruning")
    expect(warnings[0].shortText).toContain("9,800")
    expect(warnings[0].shortText).toContain("10,000")
  })

  it("does NOT fire on the story's own healthy example: 50/10000 scanned", () => {
    expect(run(makeScan({ partitionsScanned: 50, partitionsTotal: 10_000 }))).toEqual([])
  })

  it("does NOT warn on a tiny table (low total partition count), even at a high ratio", () => {
    expect(run(makeScan({ partitionsScanned: 4, partitionsTotal: 5 }))).toEqual([])
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 } })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire when pruning data is entirely absent", () => {
    expect(() => run(makeScan({}))).not.toThrow()
    expect(run(makeScan({}))).toEqual([])
  })

  it("escalates to critical above the severe-ratio threshold, warning below it", () => {
    const warning = run(makeScan({ partitionsScanned: 5_500, partitionsTotal: 10_000 })) // 55%
    expect(warning[0].severity).toBe("warning")

    const critical = run(makeScan({ partitionsScanned: 9_800, partitionsTotal: 10_000 })) // 98%
    expect(critical[0].severity).toBe("critical")
  })

  it("explains the pruning-metadata mechanism without prescribing a specific schema fix as certain", () => {
    const longText = run(makeScan({ partitionsScanned: 9_800, partitionsTotal: 10_000 }))[0].longText
    expect(longText).toContain("clustered")
    expect(longText).toContain("this plan alone can't say")
  })

  it("does not throw on pathological numeric input", () => {
    for (const partitionsScanned of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() => run(makeScan({ partitionsScanned, partitionsTotal: 10_000 }))).not.toThrow()
    }
  })
})
