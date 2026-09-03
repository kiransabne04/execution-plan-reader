import { describe, expect, it } from "vitest"
import { parsePostgresJsonPlan } from "../parseJsonPlan"
import { parsePostgresTextPlan } from "../textParser"
import { collectNodes } from "../../normalize"
import { loadFixture } from "./testUtils"

describe("Postgres extended fields (docs/10-node-stats-field-catalog.md)", () => {
  it("promotes predicate.filter and predicate.joinCondition, and normalizes join.logicalType", () => {
    const root = parsePostgresJsonPlan(loadFixture("multi-way-join.json"))
    expect(root.predicate?.joinCondition).toBe("(orders.customer_id = customers.id)")
    expect(root.join?.logicalType).toBe("inner")
  })

  it("promotes index.name and index.scanDirection, leaving index.type undefined (honest gap)", () => {
    const root = parsePostgresJsonPlan(loadFixture("initplan-subplan.json"))
    const subplanScan = collectNodes(root).find((n) => n.role === "sub")!
    expect(subplanScan.index?.name).toBe("orders_region_idx")
    expect(subplanScan.index?.type).toBeUndefined()
  })

  it("promotes rowsRemovedByFilter when present", () => {
    const raw = JSON.stringify([
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Total Cost": 10,
          "Plan Rows": 5,
          "Actual Rows": 5,
          "Actual Loops": 1,
          "Actual Total Time": 1,
          Filter: "(status = 'active')",
          "Rows Removed by Filter": 995,
        },
      },
    ])
    const root = parsePostgresJsonPlan(raw)
    expect(root.rowsRemovedByFilter).toBe(995)
    expect(root.predicate?.filter).toBe("(status = 'active')")
  })

  it("sets actualTimePerExecutionMs equal to actualTimeMs (already loop-averaged by Postgres itself)", () => {
    const root = parsePostgresJsonPlan(loadFixture("simple-seq-scan.json"))
    expect(root.actualTimePerExecutionMs).toBe(root.actualTimeMs)
  })

  it("promotes io.bufferHits/bufferReads and derives cacheHitRatio when BUFFERS was captured", () => {
    const raw = JSON.stringify([
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Total Cost": 10,
          "Plan Rows": 100,
          "Actual Rows": 100,
          "Actual Loops": 1,
          "Actual Total Time": 1,
          "Shared Hit Blocks": 80,
          "Shared Read Blocks": 20,
        },
      },
    ])
    const root = parsePostgresJsonPlan(raw)
    expect(root.io?.bufferHits).toBe(80)
    expect(root.io?.bufferReads).toBe(20)
    expect(root.io?.cacheHitRatio).toBeCloseTo(0.8)
  })

  it("leaves io undefined when BUFFERS wasn't captured, rather than showing a fabricated zero", () => {
    const root = parsePostgresJsonPlan(loadFixture("simple-seq-scan.json"))
    expect(root.io).toBeUndefined()
  })

  it("promotes spill for an external-merge Sort (Sort Space Type: Disk), converting KB to bytes", () => {
    const raw = JSON.stringify([
      {
        Plan: {
          "Node Type": "Sort",
          "Total Cost": 100,
          "Plan Rows": 100000,
          "Actual Rows": 100000,
          "Actual Loops": 1,
          "Actual Total Time": 500,
          "Sort Method": "external merge",
          "Sort Space Type": "Disk",
          "Sort Space Used": 25000,
        },
      },
    ])
    const root = parsePostgresJsonPlan(raw)
    expect(root.spill?.occurred).toBe(true)
    expect(root.spill?.bytesLocal).toBe(25000 * 1024)
  })

  it("does not report spill for an in-memory sort", () => {
    const raw = JSON.stringify([
      {
        Plan: {
          "Node Type": "Sort",
          "Total Cost": 10,
          "Plan Rows": 10,
          "Actual Rows": 10,
          "Actual Loops": 1,
          "Actual Total Time": 1,
          "Sort Method": "quicksort",
          "Sort Space Type": "Memory",
          "Sort Space Used": 25,
        },
      },
    ])
    const root = parsePostgresJsonPlan(raw)
    expect(root.spill).toBeUndefined()
  })

  it("promotes parallel.workersLaunched/workersPlanned", () => {
    const root = parsePostgresJsonPlan(loadFixture("parallel-workers-cumulated.json"))
    expect(root.parallel?.workersLaunched).toBe(3)
    expect(root.parallel?.workersPlanned).toBe(3)
  })

  it("derives the same extended fields via the TEXT parser (detail lines attach after node creation)", () => {
    const root = parsePostgresTextPlan(loadFixture("multi-way-join-text.txt"))
    expect(root.predicate?.joinCondition).toBe("(orders.customer_id = customers.id)")
    expect(root.join?.logicalType).toBe("inner")
  })

  it("TEXT parser: InitPlan/SubPlan index details still promote correctly after the post-pass", () => {
    const root = parsePostgresTextPlan(loadFixture("initplan-subplan-text.txt"))
    const subplanScan = collectNodes(root).find((n) => n.role === "sub")!
    expect(subplanScan.index?.name).toBe("orders_region_idx")
  })

  // Episode 24
  describe("heapFetches (Story 24.1)", () => {
    it("promotes heapFetches from JSON's Heap Fetches", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Index Only Scan", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 1500000, "Actual Loops": 1, "Actual Total Time": 1, "Heap Fetches": 1350000 } }])
      expect(parsePostgresJsonPlan(raw).heapFetches).toBe(1350000)
    })

    it("promotes heapFetches from a TEXT detail line", () => {
      const text = "Index Only Scan using t_pkey on t  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..5.00 rows=1500000 loops=1)\n  Heap Fetches: 1350000"
      expect(parsePostgresTextPlan(text).heapFetches).toBe(1350000)
    })
  })

  describe("rowsRemovedByJoinFilter (Story 24.3)", () => {
    it("promotes from JSON", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Hash Join", "Total Cost": 10, "Plan Rows": 50000, "Actual Rows": 50000, "Actual Loops": 1, "Actual Total Time": 1, "Rows Removed by Join Filter": 19950000 } }])
      expect(parsePostgresJsonPlan(raw).rowsRemovedByJoinFilter).toBe(19950000)
    })

    it("promotes from a TEXT detail line", () => {
      const text = "Hash Join  (cost=0.00..10.00 rows=50000 width=4) (actual time=0.01..5.00 rows=50000 loops=1)\n  Rows Removed by Join Filter: 19950000"
      expect(parsePostgresTextPlan(text).rowsRemovedByJoinFilter).toBe(19950000)
    })
  })

  describe("sort (Story 24.5)", () => {
    it("promotes sort.method/spaceUsedKb/spaceType='disk' from JSON, for an external merge", () => {
      const root = parsePostgresJsonPlan(loadFixture("rule-disk-spill-sort.json"))
      expect(root.sort).toEqual({ method: "external merge", spaceUsedKb: 102400, spaceType: "disk" })
    })

    it("promotes an in-memory quicksort as spaceType='memory'", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Sort", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 1, "Sort Method": "quicksort", "Sort Space Used": 25, "Sort Space Type": "Memory" } }])
      expect(parsePostgresJsonPlan(raw).sort).toEqual({ method: "quicksort", spaceUsedKb: 25, spaceType: "memory" })
    })

    it("promotes sort.method/spaceUsedKb/spaceType from the TEXT combined 'Sort Method: X  Disk: Ykb' line", () => {
      const text = "Sort  (cost=0.00..10.00 rows=200000 width=64) (actual time=0.01..5.00 rows=200000 loops=1)\n  Sort Method: external merge  Disk: 100400kB"
      expect(parsePostgresTextPlan(text).sort).toEqual({ method: "external merge", spaceUsedKb: 100400, spaceType: "disk" })
    })

    it("promotes an in-memory sort from the TEXT combined line too", () => {
      const text = "Sort  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..0.02 rows=5 loops=1)\n  Sort Method: quicksort  Memory: 25kB"
      expect(parsePostgresTextPlan(text).sort).toEqual({ method: "quicksort", spaceUsedKb: 25, spaceType: "memory" })
    })
  })

  describe("hash (Story 24.4)", () => {
    it("promotes buckets/batches/originalBatches/peakMemoryKb from JSON, routed by operatorType (not confused with Memoize)", () => {
      const root = parsePostgresJsonPlan(loadFixture("rule-disk-spill-hash.json"))
      expect(root.hash).toEqual({ buckets: 16384, batches: 4, originalBatches: 1, peakMemoryKb: 4096 })
    })

    it("promotes from the TEXT combined 'Buckets: N  Batches: M (originally O)  Memory Usage: Pkb' line", () => {
      const text = "Hash  (cost=0.00..10.00 rows=8000 width=32) (actual time=0.01..5.00 rows=8000 loops=1)\n  Buckets: 16384 (originally 1024)  Batches: 4 (originally 1)  Memory Usage: 4096kB"
      expect(parsePostgresTextPlan(text).hash).toEqual({ buckets: 16384, batches: 4, originalBatches: 1, peakMemoryKb: 4096 })
    })

    it("does not attribute Peak Memory Usage to hash on a Memoize node", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Memoize", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 1, "Peak Memory Usage": 4096 } }])
      expect(parsePostgresJsonPlan(raw).hash).toBeUndefined()
    })
  })

  describe("memoize (Story 24.10)", () => {
    it("promotes cache hit/miss/eviction/overflow counts and peakMemoryKb, routed by operatorType", () => {
      const raw = JSON.stringify([
        { Plan: { "Node Type": "Memoize", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 1, "Cache Hits": 950, "Cache Misses": 50, "Cache Evictions": 10, "Cache Overflows": 0, "Peak Memory Usage": 512 } },
      ])
      expect(parsePostgresJsonPlan(raw).memoize).toEqual({ cacheHits: 950, cacheMisses: 50, cacheEvictions: 10, cacheOverflows: 0, peakMemoryKb: 512 })
    })

    it("does not attribute Peak Memory Usage to memoize on a Hash node", () => {
      const root = parsePostgresJsonPlan(loadFixture("rule-disk-spill-hash.json"))
      expect(root.memoize).toBeUndefined()
    })
  })

  describe("temp I/O (Story 24.6)", () => {
    it("promotes io.tempReadBlocks/tempWrittenBlocks from JSON", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Sort", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 1, "Temp Read Blocks": 500, "Temp Written Blocks": 500 } }])
      expect(parsePostgresJsonPlan(raw).io).toEqual({ bufferHits: undefined, bufferReads: undefined, cacheHitRatio: undefined, ioReadTimeMs: undefined, ioWriteTimeMs: undefined, tempReadBlocks: 500, tempWrittenBlocks: 500 })
    })

    it("promotes from TEXT detail lines", () => {
      const text = "Sort  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..5.00 rows=5 loops=1)\n  Temp Read Blocks: 500\n  Temp Written Blocks: 500"
      expect(parsePostgresTextPlan(text).io?.tempReadBlocks).toBe(500)
      expect(parsePostgresTextPlan(text).io?.tempWrittenBlocks).toBe(500)
    })
  })

  describe("wal (Story 24.12)", () => {
    it("promotes records/fpi/bytes from JSON", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Insert", "Total Cost": 10, "Plan Rows": 1, "Actual Rows": 1, "Actual Loops": 1, "Actual Total Time": 1, "WAL Records": 50000, "WAL FPI": 12, "WAL Bytes": 3480000 } }])
      expect(parsePostgresJsonPlan(raw).wal).toEqual({ records: 50000, fpi: 12, bytes: 3480000 })
    })

    it("promotes from the TEXT combined 'WAL: records=N fpi=M bytes=P' line", () => {
      const text = "Insert on t  (cost=0.00..10.00 rows=1 width=4) (actual time=0.01..5.00 rows=1 loops=1)\n  WAL: records=50000 fpi=12 bytes=3480000"
      expect(parsePostgresTextPlan(text).wal).toEqual({ records: 50000, fpi: 12, bytes: 3480000 })
    })
  })

  describe("pruning.subplansRemoved (Story 24.11)", () => {
    it("promotes from JSON", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Append", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 1, "Subplans Removed": 45 } }])
      expect(parsePostgresJsonPlan(raw).pruning).toEqual({ subplansRemoved: 45 })
    })

    it("promotes from a TEXT detail line", () => {
      const text = "Append  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..5.00 rows=5 loops=1)\n  Subplans Removed: 45"
      expect(parsePostgresTextPlan(text).pruning).toEqual({ subplansRemoved: 45 })
    })
  })

  describe("root-level planningTimeMs/executionTimeMs (Story 24.7)", () => {
    it("promotes both from JSON's top-level Planning Time/Execution Time", () => {
      const raw = JSON.stringify([{ Plan: { "Node Type": "Seq Scan", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 0.05 }, "Planning Time": 240.5, "Execution Time": 8.2 }])
      const root = parsePostgresJsonPlan(raw)
      expect(root.planningTimeMs).toBe(240.5)
      expect(root.executionTimeMs).toBe(8.2)
    })

    it("promotes both from the TEXT format's own trailing summary lines, stripping the ' ms' unit", () => {
      const text = "Seq Scan on t  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..0.05 rows=5 loops=1)\nPlanning Time: 240.500 ms\nExecution Time: 8.200 ms"
      const root = parsePostgresTextPlan(text)
      expect(root.planningTimeMs).toBe(240.5)
      expect(root.executionTimeMs).toBe(8.2)
    })

    it("stays undefined, never NaN, when absent from either format", () => {
      const jsonRoot = parsePostgresJsonPlan(loadFixture("simple-seq-scan.json"))
      expect(jsonRoot.planningTimeMs === undefined || Number.isFinite(jsonRoot.planningTimeMs)).toBe(true)
      const textRoot = parsePostgresTextPlan("Seq Scan on t  (cost=0.00..10.00 rows=5 width=4) (actual time=0.01..0.05 rows=5 loops=1)")
      expect(textRoot.planningTimeMs).toBeUndefined()
      expect(textRoot.executionTimeMs).toBeUndefined()
    })
  })

  describe("root-level jit (Story 24.8, JSON only)", () => {
    it("promotes the JIT block's Timing sub-object", () => {
      const raw = JSON.stringify([
        {
          Plan: { "Node Type": "Seq Scan", "Total Cost": 10, "Plan Rows": 5, "Actual Rows": 5, "Actual Loops": 1, "Actual Total Time": 40 },
          JIT: { Functions: 4, Timing: { Generation: 0.5, Inlining: 5, Optimization: 15, Emission: 20, Total: 40.5 } },
        },
      ])
      const root = parsePostgresJsonPlan(raw)
      expect(root.jit).toEqual({ generationMs: 0.5, inliningMs: 5, optimizationMs: 15, emissionMs: 20, totalMs: 40.5 })
    })

    it("leaves jit undefined when no JIT block is present", () => {
      const root = parsePostgresJsonPlan(loadFixture("simple-seq-scan.json"))
      expect(root.jit).toBeUndefined()
    })
  })
})
