import { describe, expect, it } from "vitest"
import { sqlServerParallelSkew } from "../sqlServerParallelSkew"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeParallelNode(perWorker: { label: string; rows?: number; timeMs?: number }[], overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "sqlserver", rawOperatorLabel: "Table Scan", parallel: { workersLaunched: perWorker.length, perWorker }, ...overrides })
}

describe("sqlServerParallelSkew", () => {
  it("does NOT fire on balanced worker threads", () => {
    const node = makeParallelNode([
      { label: "Thread 0", rows: 0 },
      { label: "Thread 1", rows: 33_333 },
      { label: "Thread 2", rows: 33_333 },
      { label: "Thread 3", rows: 33_334 },
    ])
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("fires on severely skewed worker threads with material total volume", () => {
    const node = makeParallelNode([
      { label: "Thread 0", rows: 0 },
      { label: "Thread 1", rows: 91_000 },
      { label: "Thread 2", rows: 3_000 },
      { label: "Thread 3", rows: 3_000 },
      { label: "Thread 4", rows: 3_000 },
    ])
    const warnings = sqlServerParallelSkew(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("parallel-thread-skew")
    expect(warnings[0].severity).toBe("warning")
  })

  it("excludes the coordinator thread (Thread 0) from the skew calculation", () => {
    // Thread 0 shows a huge row count but is NOT one of the real parallel
    // workers — including it would falsely read as severe skew on an
    // otherwise perfectly balanced set of workers.
    const node = makeParallelNode([
      { label: "Thread 0", rows: 500_000 },
      { label: "Thread 1", rows: 10_000 },
      { label: "Thread 2", rows: 10_000 },
      { label: "Thread 3", rows: 10_000 },
    ])
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire with fewer than the minimum worker-thread count", () => {
    const node = makeParallelNode([
      { label: "Thread 0", rows: 0 },
      { label: "Thread 1", rows: 90_000 },
      { label: "Thread 2", rows: 1_000 },
    ])
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire below the total-rows materiality floor even with a severe ratio", () => {
    const node = makeParallelNode([
      { label: "Thread 0", rows: 0 },
      { label: "Thread 1", rows: 900 },
      { label: "Thread 2", rows: 30 },
      { label: "Thread 3", rows: 30 },
      { label: "Thread 4", rows: 30 },
    ])
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const node = makeNode({
      engine: "postgres",
      parallel: {
        workersLaunched: 4,
        perWorker: [
          { label: "Thread 1", rows: 91_000 },
          { label: "Thread 2", rows: 3_000 },
          { label: "Thread 3", rows: 3_000 },
        ],
      },
    })
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("does NOT infer skew from DOP alone — no perWorker data means no finding regardless of workersLaunched", () => {
    const node = makeNode({ engine: "sqlserver", parallel: { workersLaunched: 8 } })
    expect(() => sqlServerParallelSkew(node, makeContext(node))).not.toThrow()
    expect(sqlServerParallelSkew(node, makeContext(node))).toEqual([])
  })

  it("names the max/median ratio and figures in the text", () => {
    const node = makeParallelNode([
      { label: "Thread 0", rows: 0 },
      { label: "Thread 1", rows: 91_000 },
      { label: "Thread 2", rows: 3_000 },
      { label: "Thread 3", rows: 3_000 },
      { label: "Thread 4", rows: 3_000 },
    ])
    const longText = sqlServerParallelSkew(node, makeContext(node))[0].longText
    expect(longText).toContain("91,000")
    expect(longText).toContain("3,000")
  })
})
