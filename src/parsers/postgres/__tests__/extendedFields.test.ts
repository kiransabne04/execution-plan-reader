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
})
