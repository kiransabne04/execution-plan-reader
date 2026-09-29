import { describe, expect, it } from "vitest"
import { parseStatisticsIo } from "../statisticsIo"
import { loadFixture } from "./testUtils"

const fixture = loadFixture

describe("parseStatisticsIo", () => {
  it("parses every counter on a modern multi-table output plus TIME lines", () => {
    const result = parseStatisticsIo(fixture("statistics-io-before.txt"))
    expect(result.tables.map((t) => t.table)).toEqual(["Orders", "Customers", "Worktable"])
    expect(result.tables[0]).toMatchObject({ scanCount: 1, logicalReads: 48213, physicalReads: 3, readAheadReads: 47990, pageServerReads: 0, lobLogicalReads: 0 })
    expect(result.time).toEqual({ cpuMs: 1420, elapsedMs: 1985, compileCpuMs: 12, compileElapsedMs: 12 })
  })

  it("keeps absent counters undefined (legacy format) and reads columnstore segments + LOB reads", () => {
    const result = parseStatisticsIo(fixture("statistics-io-legacy-columnstore.txt"))
    const fact = result.tables.find((t) => t.table === "FactSales")!
    expect(fact.pageServerReads).toBeUndefined()
    expect(fact).toMatchObject({ lobLogicalReads: 5120, lobReadAheadReads: 4800, segmentReads: 8, segmentSkipped: 22 })
  })

  it("sums the same table across statements, case-insensitively", () => {
    const result = parseStatisticsIo(fixture("statistics-io-legacy-columnstore.txt"))
    const fact = result.tables.find((t) => t.table === "FactSales")!
    expect(fact.scanCount).toBe(6)
    expect(fact.logicalReads).toBe(10)
    expect(parseStatisticsIo("Table 'T'. Scan count 1, logical reads 5.\nTable 't'. Scan count 1, logical reads 7.").tables).toHaveLength(1)
  })

  it("handles CRLF line endings and ignores unknown counters", () => {
    const result = parseStatisticsIo("Table 'T'. Scan count 2, logical reads 9, future counter 4.\r\n")
    expect(result.tables[0]).toEqual({ table: "T", scanCount: 2, logicalReads: 9 })
  })

  it("returns no tables for text that is not STATISTICS IO output, without echoing it", () => {
    const result = parseStatisticsIo("SELECT secret_column FROM payroll")
    expect(result).toEqual({ tables: [], time: undefined })
  })
})
