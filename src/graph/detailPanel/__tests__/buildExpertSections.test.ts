import { describe, expect, it } from "vitest"
import { buildExpertSections } from "../buildExpertSections"
import { makeNode } from "../../../rules/__tests__/testHelpers"

function section(node: ReturnType<typeof makeNode>, heading: string) {
  return buildExpertSections(node).find((s) => s.heading === heading)
}

function rowValue(node: ReturnType<typeof makeNode>, heading: string, label: string) {
  return section(node, heading)?.rows?.find((r) => r.label === label)?.value
}

describe("buildExpertSections — Rows & estimates", () => {
  it("combines estimate error with a direction, never fabricating one when the two are equal", () => {
    const overNode = makeNode({ estimatedRows: 1000, actualRows: 3000 })
    expect(rowValue(overNode, "Rows & estimates", "Estimate error")).toBe("3.000× over")

    const underNode = makeNode({ estimatedRows: 3000, actualRows: 1000 })
    expect(rowValue(underNode, "Rows & estimates", "Estimate error")).toBe("3.000× under")

    const exactNode = makeNode({ estimatedRows: 1000, actualRows: 1000 })
    expect(rowValue(exactNode, "Rows & estimates", "Estimate error")).toBe("exact match")
  })

  it("combines removed-by-filter count with its discard percentage, and derives filter selectivity as the complement", () => {
    const node = makeNode({ actualRows: 4820, rowsRemovedByFilter: 1199518 })
    expect(rowValue(node, "Rows & estimates", "Removed by filter")).toBe("1,199,518 · 99.6%")
    expect(rowValue(node, "Rows & estimates", "Filter selectivity")).toBe("0.0040")
  })

  it("shows plan width in bytes when the engine reports it, omits the row otherwise", () => {
    expect(rowValue(makeNode({ planWidth: 42 }), "Rows & estimates", "Plan width")).toBe("42 B")
    expect(rowValue(makeNode({}), "Rows & estimates", "Plan width")).toBeUndefined()
  })
})

describe("buildExpertSections — Cost & timing", () => {
  it("combines startup/total cost when startupCost is known (Postgres), shows total cost alone otherwise (SQL Server)", () => {
    const pg = makeNode({ estimatedCost: 28410, startupCost: 0 })
    expect(rowValue(pg, "Cost & timing", "Startup / total cost")).toBe("0.00 / 28410.00")

    const sqlServer = makeNode({ engine: "sqlserver", estimatedCost: 12.5 })
    expect(rowValue(sqlServer, "Cost & timing", "Startup / total cost")).toBe("12.50")
  })

  it("Snowflake gets an honest Cost gap row instead — no abstract cost-unit concept at all", () => {
    const node = makeNode({ engine: "snowflake", estimatedCost: undefined })
    const row = section(node, "Cost & timing")?.rows?.find((r) => r.label === "Cost")
    expect(row?.isGap).toBe(true)
    expect(row?.value).toBe("not applicable for this engine")
  })

  it("combines per-execution time with the loop count", () => {
    const node = makeNode({ actualTimeMs: 842.1, actualTimePerExecutionMs: 842.1, loops: 1 })
    expect(rowValue(node, "Cost & timing", "Per execution")).toBe("842.1 ms · 1 loop")

    const multiLoop = makeNode({ actualTimeMs: 200, actualTimePerExecutionMs: 100, loops: 2 })
    expect(rowValue(multiLoop, "Cost & timing", "Per execution")).toBe("100 ms · 2 loops")
  })

  it("shows Planning/execution and JIT only on the root node (where those whole-plan facts actually live)", () => {
    const nonRoot = makeNode({ actualTimeMs: 5 })
    expect(section(nonRoot, "Cost & timing")?.rows?.find((r) => r.label === "Planning / execution")).toBeUndefined()
    expect(section(nonRoot, "Cost & timing")?.rows?.find((r) => r.label === "JIT")).toBeUndefined()

    const root = makeNode({ actualTimeMs: 5, planningTimeMs: 1.4, executionTimeMs: 2611 })
    expect(rowValue(root, "Cost & timing", "Planning / execution")).toBe("1.4 ms / 2,611 ms")
    const jitRow = section(root, "Cost & timing")?.rows?.find((r) => r.label === "JIT")
    expect(jitRow?.value).toBe("not in this plan")
    expect(jitRow?.isGap).toBe(true)

    const withJit = makeNode({ actualTimeMs: 5, planningTimeMs: 1, executionTimeMs: 2, jit: { totalMs: 45 } })
    expect(rowValue(withJit, "Cost & timing", "JIT")).toBe("45 ms")
  })
})

describe("buildExpertSections — Buffers", () => {
  it("combines hit/read, dirtied/written, temp read/written, and I/O read/write time", () => {
    const node = makeNode({
      io: { bufferHits: 18204, bufferReads: 9912, bufferDirtied: 3, bufferWritten: 1, tempReadBlocks: 0, tempWrittenBlocks: 0, ioReadTimeMs: 311.4, ioWriteTimeMs: 0 },
    })
    expect(rowValue(node, "Buffers", "Shared hit / read")).toBe("18,204 / 9,912")
    expect(rowValue(node, "Buffers", "Shared dirtied / written")).toBe("3 / 1")
    expect(rowValue(node, "Buffers", "Temp read / written")).toBe("0 / 0")
    expect(rowValue(node, "Buffers", "I/O read / write time")).toBe("311.4 ms / 0 ms")
  })

  it("omits the whole section when the engine/plan reports no buffer data at all", () => {
    expect(section(makeNode({ io: undefined }), "Buffers")).toBeUndefined()
  })
})

describe("buildExpertSections — operator internals", () => {
  it("Scan internals: index type gap differs by engine (Postgres 'not determinable', Snowflake 'not applicable')", () => {
    const pg = makeNode({ operatorType: "seq_scan" })
    const pgRow = section(pg, "Scan internals")?.rows?.find((r) => r.label === "Index type")
    expect(pgRow?.value).toBe("not determinable from the plan alone")

    const snowflake = makeNode({ engine: "snowflake", operatorType: "seq_scan" })
    const sfRow = section(snowflake, "Scan internals")?.rows?.find((r) => r.label === "Index type")
    expect(sfRow?.value).toBe("not applicable for this engine")
  })

  it("Heap fetches only appears as a real number for an actual index-only scan, else an honest n/a", () => {
    const seqScan = makeNode({ operatorType: "seq_scan" })
    expect(rowValue(seqScan, "Scan internals", "Heap fetches")).toBe("n/a — not an index-only scan")

    const indexOnly = makeNode({ operatorType: "index_only_scan", heapFetches: 12 })
    expect(rowValue(indexOnly, "Scan internals", "Heap fetches")).toBe("12")
  })

  it("Hash internals appear for a Hash node, never alongside Scan internals", () => {
    const node = makeNode({ operatorType: "hash", hash: { buckets: 1024, batches: 4, originalBatches: 1, peakMemoryKb: 4096 } })
    expect(rowValue(node, "Hash internals", "Hash buckets")).toBe("1,024")
    expect(rowValue(node, "Hash internals", "Hash batches")).toBe("4 (originally 1)")
    expect(section(node, "Hash internals")?.rows?.find((r) => r.label === "Hash batches")?.isWarning).toBe(true)
    expect(section(node, "Scan internals")).toBeUndefined()
  })

  it("omits operator-internals entirely for a node with none of scan/hash/sort/memoize data", () => {
    const node = makeNode({ operatorType: "hash_join" })
    expect(buildExpertSections(node).some((s) => s.heading.endsWith("internals"))).toBe(false)
  })
})

describe("buildExpertSections — Parallelism", () => {
  it("flags a workers-launched shortfall in amber, same convention as buildStatRows.ts", () => {
    const node = makeNode({ parallel: { workersPlanned: 4, workersLaunched: 2 } })
    const row = section(node, "Parallelism")?.rows?.find((r) => r.label === "Workers launched")
    expect(row?.isWarning).toBe(true)
  })

  it("renders one row per real per-worker entry, never a synthetic average split", () => {
    const node = makeNode({
      parallel: {
        workersPlanned: 2,
        workersLaunched: 2,
        perWorker: [
          { label: "Worker 0", rows: 601204, timeMs: 418.7 },
          { label: "Worker 1", rows: 603134, timeMs: 423.4 },
        ],
      },
    })
    expect(rowValue(node, "Parallelism", "Worker 0")).toBe("601,204 rows · 418.7 ms")
    expect(rowValue(node, "Parallelism", "Worker 1")).toBe("603,134 rows · 423.4 ms")
  })

  it("omits the section entirely when there's no parallelism signal at all (e.g. Snowflake)", () => {
    expect(section(makeNode({ engine: "snowflake" }), "Parallelism")).toBeUndefined()
  })
})

describe("buildExpertSections — Output columns", () => {
  it("renders the real projected column list as free text, omits the section when absent", () => {
    const node = makeNode({ outputColumns: ["o.id", "o.customer_id", "o.total"] })
    expect(section(node, "Output columns")?.freeText).toBe("o.id, o.customer_id, o.total")
    expect(section(makeNode({}), "Output columns")).toBeUndefined()
  })
})
