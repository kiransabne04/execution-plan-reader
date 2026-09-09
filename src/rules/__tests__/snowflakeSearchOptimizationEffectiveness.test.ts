import { describe, expect, it } from "vitest"
import { LOW_EFFECTIVENESS_RATIO, MIN_PARTITIONS_TOTAL_THRESHOLD, snowflakeSearchOptimizationEffectiveness } from "../snowflakeSearchOptimizationEffectiveness"
import { makeContext, makeNode } from "./testHelpers"

function makeScan(prunedBySO: number, partitionsTotal: number) {
  return makeNode({
    engine: "snowflake",
    operatorType: "seq_scan",
    pruning: { partitionsTotal },
    searchOptimization: { partitionsPrunedBySearchOptimization: prunedBySO },
  })
}

describe("snowflakeSearchOptimizationEffectiveness", () => {
  it("fires (info) when Search Optimization's own contribution is low relative to table size", () => {
    const node = makeScan(100, MIN_PARTITIONS_TOTAL_THRESHOLD)
    const warnings = snowflakeSearchOptimizationEffectiveness(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("search-optimization-effectiveness")
    expect(warnings[0].severity).toBe("info")
  })

  it("does not fire when Search Optimization's contribution is above the low-effectiveness ratio", () => {
    const node = makeScan(MIN_PARTITIONS_TOTAL_THRESHOLD * (LOW_EFFECTIVENESS_RATIO + 0.1), MIN_PARTITIONS_TOTAL_THRESHOLD)
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("fires exactly at the low-effectiveness ratio boundary", () => {
    const partitionsTotal = MIN_PARTITIONS_TOTAL_THRESHOLD
    const prunedBySO = partitionsTotal * LOW_EFFECTIVENESS_RATIO
    const node = makeScan(prunedBySO, partitionsTotal)
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire below the total-partitions materiality floor", () => {
    const node = makeScan(1, MIN_PARTITIONS_TOTAL_THRESHOLD - 1)
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire when searchOptimization data is absent (service not in use)", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "seq_scan", pruning: { partitionsTotal: MIN_PARTITIONS_TOTAL_THRESHOLD } })
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire when pruning.partitionsTotal is unknown", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "seq_scan", searchOptimization: { partitionsPrunedBySearchOptimization: 10 } })
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeScan(100, MIN_PARTITIONS_TOTAL_THRESHOLD)
    node.engine = "postgres"
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("never recommends cancelling Search Optimization — only states the observation", () => {
    const node = makeScan(100, MIN_PARTITIONS_TOTAL_THRESHOLD)
    const longText = snowflakeSearchOptimizationEffectiveness(node, makeContext(node))[0].longText
    expect(longText).not.toMatch(/cancel|disable|turn off/i)
    expect(longText).toContain("worth checking")
  })

  it("is always info severity, never warning or critical", () => {
    const node = makeScan(0, MIN_PARTITIONS_TOTAL_THRESHOLD * 10)
    expect(snowflakeSearchOptimizationEffectiveness(node, makeContext(node))[0].severity).toBe("info")
  })
})
