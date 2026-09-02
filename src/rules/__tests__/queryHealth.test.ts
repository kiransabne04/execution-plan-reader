import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import type { PlanNode, Warning } from "../../parsers/normalize"
import { computeQueryHealth } from "../queryHealth"
import { makeContext, makeNode } from "./testHelpers"
import { analyzePlanText } from "../../app/analyzePlan"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

function warning(ruleId: string, severity: Warning["severity"]): Warning {
  return { ruleId, severity, shortText: `${ruleId} short`, longText: `${ruleId} long` }
}

function tree(children: PlanNode[] = []): PlanNode {
  return makeNode({ id: "root", children })
}

describe("computeQueryHealth", () => {
  describe("Runtime dimension", () => {
    it("insufficient-data on an estimate-only plan (no actual execution data)", () => {
      const root = tree()
      const context = makeContext(root, { hasActualData: false })
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.runtime).toEqual({ status: "insufficient-data" })
    })

    it("scores 100 when eligible and clean", () => {
      const root = tree()
      const context = makeContext(root, { hasActualData: true })
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.runtime).toEqual({ status: "scored", score: 100 })
    })

    it("penalizes a critical seq-scan-on-large-table finding", () => {
      const root = tree([makeNode({ id: "a", warnings: [warning("seq-scan-on-large-table", "critical")] })])
      const context = makeContext(root, { hasActualData: true })
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.runtime).toEqual({ status: "scored", score: 70 })
    })
  })

  describe("Cardinality dimension", () => {
    it("insufficient-data when no node has an estimatedRows figure at all", () => {
      const root = tree()
      const context = makeContext(root)
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.cardinality).toEqual({ status: "insufficient-data" })
    })

    it("sums penalties across two DIFFERENT families in the same dimension (100 - 30 - 12 = 58)", () => {
      const root = tree([
        makeNode({ id: "a", estimatedRows: 10, warnings: [warning("bad-row-estimate", "critical")] }),
        makeNode({ id: "b", estimatedRows: 10, warnings: [warning("exploding-join", "warning")] }),
      ])
      const context = makeContext(root)
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.cardinality).toEqual({ status: "scored", score: 58 })
    })

    it("worst-instance-per-family: the SAME family firing on two nodes at different severities only costs one penalty", () => {
      const root = tree([
        makeNode({ id: "a", estimatedRows: 10, warnings: [warning("bad-row-estimate", "critical")] }),
        makeNode({ id: "b", estimatedRows: 10, warnings: [warning("bad-row-estimate", "warning")] }),
      ])
      const context = makeContext(root)
      const health = computeQueryHealth(root, context)
      // Worst instance (critical, -30) wins — not -30-12=-42.
      expect(health.dimensions.cardinality).toEqual({ status: "scored", score: 70 })
    })
  })

  describe("Memory dimension", () => {
    it("insufficient-data when no node has spill detection attempted at all", () => {
      const root = tree()
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.memory).toEqual({ status: "insufficient-data" })
    })

    it("eligible (spill field present) but clean scores 100", () => {
      const root = tree([makeNode({ id: "a", spill: { occurred: false } })])
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.memory).toEqual({ status: "scored", score: 100 })
    })

    it("penalizes a warning-severity disk-spill finding", () => {
      const root = tree([makeNode({ id: "a", spill: { occurred: true }, warnings: [warning("disk-spill", "warning")] })])
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.memory).toEqual({ status: "scored", score: 88 })
    })
  })

  describe("I/O dimension", () => {
    it("insufficient-data when no node has buffer or disk-I/O-time-share data", () => {
      const root = tree()
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.io).toEqual({ status: "insufficient-data" })
    })

    it("eligible via Snowflake's timeBreakdown disk-I/O share, even with no bufferHits/bufferReads at all", () => {
      const root = tree([makeNode({ id: "a", engine: "snowflake", timeBreakdown: { localDiskIoPercentage: 40 } })])
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.io).toEqual({ status: "scored", score: 100 })
    })
  })

  describe("Parallelism dimension", () => {
    it("insufficient-data when no node has both workersPlanned and workersLaunched", () => {
      const root = tree([makeNode({ id: "a", parallel: { workersLaunched: 2 } })]) // SQL Server-shaped: launched only
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.parallelism).toEqual({ status: "insufficient-data" })
    })

    it("scores when Postgres-shaped parallel info (both fields) is present", () => {
      const root = tree([makeNode({ id: "a", parallel: { workersPlanned: 4, workersLaunched: 4 } })])
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.parallelism).toEqual({ status: "scored", score: 100 })
    })
  })

  describe("excluded rule ids", () => {
    it("parameter-sensitivity-honesty-note and estimate-only-plan never penalize, even though they're real Warning entries", () => {
      const root = tree([
        makeNode({
          id: "root2",
          estimatedRows: 10,
          warnings: [warning("parameter-sensitivity-honesty-note", "info"), warning("estimate-only-plan", "info")],
        }),
      ])
      const context = makeContext(root)
      expect(computeQueryHealth(root, context).dimensions.cardinality).toEqual({ status: "scored", score: 100 })
    })
  })

  describe("overall score", () => {
    it("is the equal-weighted average of scored dimensions only", () => {
      const root = tree([
        makeNode({ id: "a", estimatedRows: 10, warnings: [warning("bad-row-estimate", "critical")] }), // cardinality: 70
        makeNode({ id: "b", spill: { occurred: false } }), // memory: 100
      ])
      const context = makeContext(root, { hasActualData: false }) // runtime & parallelism stay insufficient-data; io stays insufficient-data too
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.runtime).toEqual({ status: "insufficient-data" })
      expect(health.dimensions.io).toEqual({ status: "insufficient-data" })
      expect(health.dimensions.parallelism).toEqual({ status: "insufficient-data" })
      expect(health.dimensions.cardinality).toEqual({ status: "scored", score: 70 })
      expect(health.dimensions.memory).toEqual({ status: "scored", score: 100 })
      // (70 + 100) / 2 = 85
      expect(health.overall).toEqual({ status: "scored", score: 85 })
    })

    it("is insufficient-data at the top level when ZERO dimensions have enough data to score", () => {
      const root = tree() // no estimatedRows, no spill, no io, no timeBreakdown, no parallel anywhere
      const context = makeContext(root, { hasActualData: false })
      expect(computeQueryHealth(root, context).overall).toEqual({ status: "insufficient-data" })
    })

    it("every eligible dimension scores exactly 100 — not undefined/NaN — when nothing fires anywhere", () => {
      const root = tree([
        makeNode({ id: "a", estimatedRows: 10, spill: { occurred: false }, io: { bufferHits: 10, bufferReads: 0 }, parallel: { workersPlanned: 2, workersLaunched: 2 } }),
      ])
      const context = makeContext(root, { hasActualData: true })
      const health = computeQueryHealth(root, context)
      for (const dimension of ["runtime", "cardinality", "memory", "io", "parallelism"] as const) {
        expect(health.dimensions[dimension]).toEqual({ status: "scored", score: 100 })
      }
      expect(health.overall).toEqual({ status: "scored", score: 100 })
    })
  })

  describe("node-scoped severity counts", () => {
    it("critical + warning + healthy always equals the total node count, with no double-counting", () => {
      const root = tree([
        makeNode({ id: "a", warnings: [warning("disk-spill", "critical"), warning("bad-row-estimate", "warning")] }), // critical (worst wins the bucket)
        makeNode({ id: "b", warnings: [warning("bad-row-estimate", "warning")] }), // warning
        makeNode({ id: "c", warnings: [] }), // healthy
      ])
      const context = makeContext(root)
      const health = computeQueryHealth(root, context)
      expect(health.critical).toBe(1)
      expect(health.warning).toBe(1)
      expect(health.healthy).toBe(2) // "c" plus the implicit root node itself
      expect(health.critical + health.warning + health.healthy).toBe(context.nodeCount)
    })
  })

  describe("Snowflake cross-engine coverage", () => {
    it("Parallelism stays insufficient-data on a Snowflake plan while Runtime/Cardinality/Memory/I-O all score", () => {
      const root = tree([
        makeNode({
          id: "a",
          engine: "snowflake",
          operatorType: "seq_scan",
          actualRows: 5000,
          estimatedRows: 4800,
          spill: { occurred: false },
          timeBreakdown: { localDiskIoPercentage: 5, remoteDiskIoPercentage: 0 },
        }),
      ])
      const context = makeContext(root, { engine: "snowflake", hasActualData: true })
      const health = computeQueryHealth(root, context)
      expect(health.dimensions.parallelism).toEqual({ status: "insufficient-data" })
      expect(health.dimensions.runtime.status).toBe("scored")
      expect(health.dimensions.cardinality.status).toBe("scored")
      expect(health.dimensions.memory.status).toBe("scored")
      expect(health.dimensions.io.status).toBe("scored")
    })
  })

  describe("end-to-end through analyzePlanText (not just the function in isolation)", () => {
    it("a real Postgres fixture with a genuine bad-row-estimate finding scores Cardinality below 100", () => {
      const { statements } = analyzePlanText(loadFixture("postgres", "rule-bad-row-estimate.json"))
      const health = computeQueryHealth(statements[0].root, statements[0].context)
      expect(health.dimensions.cardinality.status).toBe("scored")
      expect((health.dimensions.cardinality as { status: "scored"; score: number }).score).toBeLessThan(100)
    })

    it("a clean real Postgres fixture with no findings scores 100 on every eligible dimension", () => {
      const { statements } = analyzePlanText(loadFixture("postgres", "simple-seq-scan.json"))
      const health = computeQueryHealth(statements[0].root, statements[0].context)
      for (const dimension of Object.values(health.dimensions)) {
        if (dimension.status === "scored") expect(dimension.score).toBe(100)
      }
    })

    // Episode 23, Story 23.2 — Parallelism now scores on SQL Server too,
    // via the new context.compiledDegreeOfParallelism field.
    it("Parallelism scores (not insufficient-data) on a real SQL Server fixture with a genuine shortfall", () => {
      const { statements } = analyzePlanText(loadFixture("sqlserver", "parallel-dop-shortfall-critical.xml"))
      const health = computeQueryHealth(statements[0].root, statements[0].context)
      expect(health.dimensions.parallelism.status).toBe("scored")
      expect((health.dimensions.parallelism as { status: "scored"; score: number }).score).toBeLessThan(100)
    })

    it("Parallelism stays insufficient-data on an estimate-only SQL Server fixture, even with DegreeOfParallelism > 1", () => {
      const { statements } = analyzePlanText(loadFixture("sqlserver", "real-world-large-parallel-estimated.xml"))
      const health = computeQueryHealth(statements[0].root, statements[0].context)
      expect(health.dimensions.parallelism).toEqual({ status: "insufficient-data" })
    })
  })
})
