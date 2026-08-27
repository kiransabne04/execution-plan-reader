import { describe, expect, it } from "vitest"
import { buildStatRows } from "../buildStatRows"
import { makeNode } from "../../../rules/__tests__/testHelpers"

function labels(rows: ReturnType<typeof buildStatRows>): string[] {
  return rows.map((r) => r.label)
}

describe("buildStatRows", () => {
  it("shows estimated and actual rows", () => {
    const node = makeNode({ estimatedRows: 100, actualRows: 120 })
    const rows = buildStatRows(node)
    expect(rows.find((r) => r.label === "Estimated rows")?.value).toBe("100")
    expect(rows.find((r) => r.label === "Actual rows")?.value).toBe("120")
  })

  it("states 'no actual run data' for an estimate-only node, without a blank/undefined-looking row", () => {
    const node = makeNode({ estimatedRows: 100, estimatedCost: 10 })
    const rows = buildStatRows(node)
    const actualRow = rows.find((r) => r.label === "Actual rows")
    expect(actualRow?.isGap).toBe(true)
    expect(actualRow?.value).not.toMatch(/undefined|NaN/)
    const timeRow = rows.find((r) => r.label === "Time")
    expect(timeRow?.isGap).toBe(true)
  })

  it("omits the 'actual rows' gap row entirely when there was never an estimate either (nothing to compare)", () => {
    const node = makeNode({})
    expect(buildStatRows(node).some((r) => r.label === "Actual rows")).toBe(false)
  })

  it("shows a single Time row when actualTimeMs and actualTimePerExecutionMs are equal (Postgres)", () => {
    const node = makeNode({ engine: "postgres", actualTimeMs: 5, actualTimePerExecutionMs: 5 })
    const rows = buildStatRows(node)
    expect(labels(rows)).toContain("Time")
    expect(rows.some((r) => r.isCumulatedTiming)).toBe(false)
  })

  it("shows the two-row cumulated/per-execution split when the figures genuinely differ (SQL Server threads)", () => {
    const node = makeNode({
      engine: "sqlserver",
      actualTimeMs: 120,
      actualTimePerExecutionMs: 40,
      parallel: { workersLaunched: 3 },
    })
    const rows = buildStatRows(node).filter((r) => r.isCumulatedTiming)
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toContain("3 workers/threads")
    expect(rows[0].value).toContain("120")
    expect(rows[1].label).toBe("Per-execution (approx.)")
    expect(rows[1].value).toContain("40")
  })

  it("marks Postgres index type as an honest 'not determinable' gap, never guessed", () => {
    const node = makeNode({ engine: "postgres", index: { name: "orders_idx" } })
    const row = buildStatRows(node).find((r) => r.label === "Index type")
    expect(row?.isGap).toBe(true)
    expect(row?.value).toContain("not determinable")
  })

  it("shows a real index type for SQL Server when IndexKind was captured", () => {
    const node = makeNode({ engine: "sqlserver", index: { name: "IX_Foo", type: "nonclustered" } })
    const row = buildStatRows(node).find((r) => r.label === "Index type")
    expect(row?.isGap).toBeFalsy()
    expect(row?.value).toBe("nonclustered")
  })

  it("marks Snowflake index type as not applicable, not a blank/guessed value", () => {
    const node = makeNode({ engine: "snowflake", index: { name: "n/a-search-path" } })
    const row = buildStatRows(node).find((r) => r.label === "Index type")
    expect(row?.isGap).toBe(true)
    expect(row?.value).toBe("not applicable for this engine")
  })

  it("flags Postgres buffer stats as not captured when BUFFERS wasn't used on a scan", () => {
    const node = makeNode({ engine: "postgres", operatorType: "seq_scan" })
    const row = buildStatRows(node).find((r) => r.label === "Buffers")
    expect(row?.isGap).toBe(true)
    expect(row?.value).toContain("EXPLAIN (ANALYZE, BUFFERS)")
  })

  it("does not show a fabricated cache hit ratio when hits/reads are absent", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "hash_join" })
    expect(buildStatRows(node).some((r) => r.label === "Cache hit ratio")).toBe(false)
  })

  it("labels SQL Server's cache hit ratio as approximate", () => {
    const node = makeNode({ engine: "sqlserver", io: { bufferHits: 8, bufferReads: 2, cacheHitRatio: 0.8 } })
    const row = buildStatRows(node).find((r) => r.label === "Cache hit ratio")
    expect(row?.value).toContain("approximate")
  })

  it("does not label Postgres's cache hit ratio as approximate", () => {
    const node = makeNode({ engine: "postgres", io: { bufferHits: 8, bufferReads: 2, cacheHitRatio: 0.8 } })
    const row = buildStatRows(node).find((r) => r.label === "Cache hit ratio")
    expect(row?.value).not.toContain("approximate")
  })

  it("shows Snowflake cost as not applicable rather than a fabricated zero", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "seq_scan" })
    const row = buildStatRows(node).find((r) => r.label === "Cost")
    expect(row?.isGap).toBe(true)
    expect(row?.value).toBe("not applicable for this engine")
  })

  it("shows predicate, index, and join rows when present", () => {
    const node = makeNode({
      predicate: { filter: "status = 'x'", indexCondition: "id = 1", joinCondition: "a.id = b.id" },
      index: { name: "idx1", type: "btree", scanDirection: "Forward" },
      join: { logicalType: "left_outer" },
    })
    const rows = buildStatRows(node)
    expect(rows.find((r) => r.label === "Filter")?.value).toBe("status = 'x'")
    expect(rows.find((r) => r.label === "Index condition")?.value).toBe("id = 1")
    expect(rows.find((r) => r.label === "Join condition")?.value).toBe("a.id = b.id")
    expect(rows.find((r) => r.label === "Index name")?.value).toBe("idx1")
    expect(rows.find((r) => r.label === "Scan direction")?.value).toBe("Forward")
    expect(rows.find((r) => r.label === "Join type")?.value).toBe("left outer")
  })

  it("shows spill detail with byte counts when available", () => {
    const node = makeNode({ spill: { occurred: true, bytesLocal: 1024, bytesRemote: 2048 } })
    const row = buildStatRows(node).find((r) => r.label === "Spilled to disk")
    expect(row?.value).toContain("1,024 bytes local")
    expect(row?.value).toContain("2,048 bytes remote")
  })

  it("omits the spill row entirely when no spill occurred", () => {
    const node = makeNode({})
    expect(buildStatRows(node).some((r) => r.label === "Spilled to disk")).toBe(false)
  })

  it("shows pruning stats for Snowflake", () => {
    const node = makeNode({ engine: "snowflake", pruning: { partitionsScanned: 5, partitionsTotal: 100 } })
    const row = buildStatRows(node).find((r) => r.label === "Partitions scanned")
    expect(row?.value).toBe("5 of 100")
  })

  it("shows parallel worker counts when present", () => {
    const node = makeNode({ parallel: { workersLaunched: 4, workersPlanned: 4 } })
    const rows = buildStatRows(node)
    expect(rows.find((r) => r.label === "Workers launched")?.value).toBe("4")
    expect(rows.find((r) => r.label === "Workers planned")?.value).toBe("4")
  })

  it("shows rows removed by filter when present", () => {
    const node = makeNode({ rowsRemovedByFilter: 950 })
    expect(buildStatRows(node).find((r) => r.label === "Rows removed by filter")?.value).toBe("950")
  })

  it("never produces a row whose value contains NaN or undefined text", () => {
    const node = makeNode({
      estimatedRows: Number.NaN,
      actualRows: -1,
      estimatedCost: Number.NaN,
      io: { cacheHitRatio: Number.NaN },
    })
    const rows = buildStatRows(node)
    for (const row of rows) {
      expect(row.value).not.toMatch(/NaN|undefined/)
    }
  })
})
