import { describe, expect, it } from "vitest"
import { bufferCacheInefficiency, MIN_BUFFER_READS_THRESHOLD, CACHE_HIT_RATIO_THRESHOLD, SNOWFLAKE_DISK_IO_PERCENTAGE_THRESHOLD } from "../bufferCacheInefficiency"
import { makeContext, makeNode } from "./testHelpers"

// The rule is engine-agnostic in how it reads `io`/`timeBreakdown` — each
// parser's own tests (extendedFields.test.ts, parseShowplanXml.test.ts,
// parseOperatorStats.test.ts) prove those fields are derived correctly
// from that engine's raw signal. This suite only needs to test the
// normalized fields the rule itself consumes.
describe("bufferCacheInefficiency — Postgres/SQL Server (io.cacheHitRatio)", () => {
  it("fires on Postgres when the hit ratio is below threshold and read volume is meaningful", () => {
    const node = makeNode({
      engine: "postgres",
      rawOperatorLabel: "Seq Scan",
      io: { bufferHits: 100, bufferReads: 2_000, cacheHitRatio: 100 / 2_100 },
    })
    const warnings = bufferCacheInefficiency(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("buffer-cache-inefficiency")
    expect(warnings[0].severity).toBe("warning")
    expect(warnings[0].shortText).toContain("5%") // 100/2100 rounds to 5%
    expect(warnings[0].longText).toContain("shared_buffers")
  })

  it("fires on SQL Server with approximate wording, not Postgres's exact wording", () => {
    const node = makeNode({
      engine: "sqlserver",
      rawOperatorLabel: "Clustered Index Scan",
      io: { bufferHits: 100, bufferReads: 2_000, cacheHitRatio: 100 / 2_100 },
    })
    const [warning] = bufferCacheInefficiency(node, makeContext(node))
    expect(warning.longText).toContain("approximation")
    expect(warning.longText).toContain("buffer pool")
    expect(warning.longText).not.toContain("shared_buffers")
  })

  it("does NOT fire when the hit ratio is at or above threshold", () => {
    const node = makeNode({
      engine: "postgres",
      io: { bufferHits: 9_500, bufferReads: 500, cacheHitRatio: 9_500 / 10_000 },
    })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when read volume is below the noise floor, even at 0% hit ratio", () => {
    const node = makeNode({
      engine: "postgres",
      io: { bufferHits: 0, bufferReads: MIN_BUFFER_READS_THRESHOLD - 1, cacheHitRatio: 0 },
    })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("fires right at the read-volume floor with a bad ratio", () => {
    const node = makeNode({
      engine: "postgres",
      io: { bufferHits: 0, bufferReads: MIN_BUFFER_READS_THRESHOLD, cacheHitRatio: 0 },
    })
    expect(bufferCacheInefficiency(node, makeContext(node))).toHaveLength(1)
  })

  it("does NOT fire when io is absent entirely (Postgres plan captured without BUFFERS)", () => {
    const node = makeNode({ engine: "postgres", io: undefined })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when io is present but cacheHitRatio couldn't be computed (e.g. only I/O timing captured)", () => {
    const node = makeNode({ engine: "postgres", io: { ioReadTimeMs: 12.3 } })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("treats the threshold as a real constant, not a magic number duplicated in the test", () => {
    expect(CACHE_HIT_RATIO_THRESHOLD).toBeLessThan(1)
    expect(CACHE_HIT_RATIO_THRESHOLD).toBeGreaterThan(0)
  })
})

describe("bufferCacheInefficiency — Snowflake (timeBreakdown disk I/O share)", () => {
  it("fires when local+remote disk I/O together dominate this node's own time", () => {
    const node = makeNode({
      engine: "snowflake",
      rawOperatorLabel: "TableScan",
      timeBreakdown: { overallPercentage: 40, remoteDiskIoPercentage: 30, localDiskIoPercentage: 5 },
    })
    const [warning] = bufferCacheInefficiency(node, makeContext(node))
    expect(warning.ruleId).toBe("buffer-cache-inefficiency")
    expect(warning.shortText).toContain("35%")
    expect(warning.longText).toContain("Remote storage reads")
  })

  it("does NOT emphasize remote-storage severity when local disk dominates instead", () => {
    const node = makeNode({
      engine: "snowflake",
      timeBreakdown: { remoteDiskIoPercentage: 2, localDiskIoPercentage: 25 },
    })
    const [warning] = bufferCacheInefficiency(node, makeContext(node))
    expect(warning.longText).not.toContain("Remote storage reads")
  })

  it("does NOT fire below the disk-I/O-share threshold", () => {
    const node = makeNode({
      engine: "snowflake",
      timeBreakdown: { remoteDiskIoPercentage: 5, localDiskIoPercentage: 5 },
    })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when timeBreakdown is absent", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: undefined })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("never reads Postgres/SQL Server's io field for a Snowflake node, even if somehow present", () => {
    const node = makeNode({
      engine: "snowflake",
      io: { bufferHits: 1, bufferReads: 100_000, cacheHitRatio: 0.001 },
      timeBreakdown: undefined,
    })
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })

  it("treats the threshold as a real constant, not a magic number duplicated in the test", () => {
    expect(SNOWFLAKE_DISK_IO_PERCENTAGE_THRESHOLD).toBeGreaterThan(0)
  })
})

describe("bufferCacheInefficiency — numeric edge cases", () => {
  it("does not throw or produce garbled text on a degenerate cacheHitRatio of exactly 0 with a huge read count", () => {
    const node = makeNode({ engine: "postgres", io: { bufferHits: 0, bufferReads: 1_000_000_000, cacheHitRatio: 0 } })
    const [warning] = bufferCacheInefficiency(node, makeContext(node))
    expect(warning.shortText).not.toContain("NaN")
    expect(warning.shortText).not.toContain("undefined")
  })

  it("does not throw on a Snowflake node whose percentages sum past 100 (malformed/rounding-drift input)", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: { remoteDiskIoPercentage: 90, localDiskIoPercentage: 90 } })
    expect(() => bufferCacheInefficiency(node, makeContext(node))).not.toThrow()
  })

  it("does not throw on a non-finite timeBreakdown percentage", () => {
    const node = makeNode({ engine: "snowflake", timeBreakdown: { remoteDiskIoPercentage: Number.NaN } })
    expect(() => bufferCacheInefficiency(node, makeContext(node))).not.toThrow()
    expect(bufferCacheInefficiency(node, makeContext(node))).toEqual([])
  })
})
