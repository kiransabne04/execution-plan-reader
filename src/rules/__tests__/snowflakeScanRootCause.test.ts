import { describe, expect, it } from "vitest"
import { applyRules } from "../index"
import { buildPlanContext } from "../types"
import { groupSnowflakeScanRootCause } from "../snowflakeScanRootCause"
import { makeNode } from "./testHelpers"

const ONE_GB = 1_073_741_824

/** A single scan node exhibiting all three symptoms at once: poor pruning
 * (98%), a large scan volume with material runtime, and heavy disk I/O
 * (Snowflake's own timeBreakdown local/remote split). */
function makeTripleSymptomScan(overrides: Partial<Parameters<typeof makeNode>[0]> = {}) {
  return makeNode({
    engine: "snowflake",
    operatorType: "seq_scan",
    rawOperatorLabel: "TableScan",
    pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 },
    io: { bytesScanned: ONE_GB * 5 },
    timeBreakdown: { overallPercentage: 40, localDiskIoPercentage: 15, remoteDiskIoPercentage: 20 },
    ...overrides,
  })
}

function analyzed(root: ReturnType<typeof makeNode>) {
  applyRules(root, buildPlanContext(root))
  return root
}

describe("groupSnowflakeScanRootCause", () => {
  it("groups poor-partition-pruning as primary with large-scan-volume and buffer-cache-inefficiency as consequences", () => {
    const root = analyzed(makeTripleSymptomScan())
    const groups = groupSnowflakeScanRootCause(root)
    expect(groups).toHaveLength(1)
    expect(groups[0].primary.warning.ruleId).toBe("poor-partition-pruning")
    const consequenceRuleIds = groups[0].consequences.map((c) => c.warning.ruleId).sort()
    expect(consequenceRuleIds).toEqual(["buffer-cache-inefficiency", "large-scan-volume"])
  })

  it("does NOT group when only 2 of the 3 symptoms are present (missing disk-I/O evidence)", () => {
    const root = analyzed(makeTripleSymptomScan({ timeBreakdown: { overallPercentage: 40 } })) // no disk I/O share
    expect(groupSnowflakeScanRootCause(root)).toEqual([])
  })

  it("does NOT group when pruning alone fires with no large-scan-volume or disk-I/O finding", () => {
    const root = analyzed(
      makeNode({
        engine: "snowflake",
        operatorType: "seq_scan",
        pruning: { partitionsScanned: 9_800, partitionsTotal: 10_000 },
        // No io.bytesScanned, no timeBreakdown — nothing to co-occur with.
      }),
    )
    expect(groupSnowflakeScanRootCause(root)).toEqual([])
  })

  it("returns no groups at all when there are no findings anywhere", () => {
    const root = analyzed(makeNode({ engine: "snowflake", operatorType: "result" }))
    expect(groupSnowflakeScanRootCause(root)).toEqual([])
  })

  it("groups independently per node — a second scan without all 3 symptoms doesn't produce a group", () => {
    const good = makeNode({ engine: "snowflake", operatorType: "result" })
    const root = analyzed(makeTripleSymptomScan({ children: [good] }))
    expect(groupSnowflakeScanRootCause(root)).toHaveLength(1)
  })
})
