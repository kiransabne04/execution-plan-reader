import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { parallelShortfallSeverity, parallelWorkerShortfall } from "../parallelWorkerShortfall"
import { makeContext, makeNode } from "./testHelpers"
import { analyzePlanText } from "../../app/analyzePlan"
import { collectNodes } from "../../parsers/normalize"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

function ruleIdsFor(text: string) {
  const { statements } = analyzePlanText(text)
  return collectNodes(statements[0].root)
    .flatMap((n) => n.warnings)
    .filter((w) => w.ruleId === "parallel-worker-shortfall")
}

describe("parallelShortfallSeverity", () => {
  it("no shortfall (launched >= planned) returns undefined", () => {
    expect(parallelShortfallSeverity(4, 4)).toBeUndefined()
    expect(parallelShortfallSeverity(4, 5)).toBeUndefined() // shouldn't happen per either engine's semantics, but must not throw or misfire
  })

  it("critical when launched is 0 or under half of planned", () => {
    expect(parallelShortfallSeverity(8, 0)).toBe("critical")
    expect(parallelShortfallSeverity(8, 3)).toBe("critical")
  })

  it("warning when launched is at least half of planned but still short", () => {
    expect(parallelShortfallSeverity(8, 4)).toBe("warning")
    expect(parallelShortfallSeverity(8, 7)).toBe("warning")
  })
})

describe("parallelWorkerShortfall — Postgres (per-node)", () => {
  it("fires critical when launched is 0", () => {
    const node = makeNode({ engine: "postgres", parallel: { workersPlanned: 4, workersLaunched: 0 } })
    const context = makeContext(makeNode({ children: [node] }))
    const warnings = parallelWorkerShortfall(node, context)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe("critical")
    expect(warnings[0].shortText).toContain("4")
  })

  it("fires warning at the boundary (launched === planned/2)", () => {
    const node = makeNode({ engine: "postgres", parallel: { workersPlanned: 4, workersLaunched: 2 } })
    const context = makeContext(makeNode({ children: [node] }))
    expect(parallelWorkerShortfall(node, context)[0].severity).toBe("warning")
  })

  it("does not fire when workersPlanned === workersLaunched", () => {
    const node = makeNode({ engine: "postgres", parallel: { workersPlanned: 4, workersLaunched: 4 } })
    const context = makeContext(makeNode({ children: [node] }))
    expect(parallelWorkerShortfall(node, context)).toEqual([])
  })

  it("does not fire and does not throw when neither field is present", () => {
    const node = makeNode({ engine: "postgres" })
    const context = makeContext(makeNode({ children: [node] }))
    expect(() => parallelWorkerShortfall(node, context)).not.toThrow()
    expect(parallelWorkerShortfall(node, context)).toEqual([])
  })
})

describe("parallelWorkerShortfall — SQL Server (query-level, end-to-end through analyzePlanText)", () => {
  it("fires critical when compiled DOP far exceeds observed threads", () => {
    const findings = ruleIdsFor(loadFixture("sqlserver", "parallel-dop-shortfall-critical.xml"))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("critical")
    expect(findings[0].shortText).toContain("8")
  })

  it("fires warning at the boundary", () => {
    const findings = ruleIdsFor(loadFixture("sqlserver", "parallel-dop-shortfall-warning.xml"))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("warning")
  })

  it("does NOT fire on DegreeOfParallelism=1 (never intended to be parallel)", () => {
    expect(ruleIdsFor(loadFixture("sqlserver", "parallel-dop-one-with-reason.xml"))).toEqual([])
  })

  it("does NOT fire on an estimate-only plan even with DegreeOfParallelism > 1 — the highest-risk false-positive case", () => {
    expect(ruleIdsFor(loadFixture("sqlserver", "real-world-large-parallel-estimated.xml"))).toEqual([])
  })

  it("does NOT fire when no DegreeOfParallelism attribute exists at all", () => {
    expect(ruleIdsFor(loadFixture("sqlserver", "parallelism-multi-thread.xml"))).toEqual([])
  })

  it("NonParallelPlanReason is enrichment on an ALREADY-firing shortfall — appears in longText", () => {
    const findings = ruleIdsFor(loadFixture("sqlserver", "parallel-shortfall-with-reason.xml"))
    expect(findings).toHaveLength(1)
    expect(findings[0].longText).toContain("NoParallelDueToRowsetOverhead")
  })

  it("a NonParallelPlanReason string alone, with no numeric shortfall, never independently triggers the rule", () => {
    // DegreeOfParallelism=1 + a reason string present — the reason must not
    // be treated as its own trigger condition.
    expect(ruleIdsFor(loadFixture("sqlserver", "parallel-dop-one-with-reason.xml"))).toEqual([])
  })
})

describe("parallelWorkerShortfall — Snowflake", () => {
  it("never fires — no field either check reads is ever populated for Snowflake", () => {
    const node = makeNode({ engine: "snowflake" })
    const context = makeContext(makeNode({ engine: "snowflake", children: [node] }), { engine: "snowflake" })
    expect(() => parallelWorkerShortfall(node, context)).not.toThrow()
    expect(parallelWorkerShortfall(node, context)).toEqual([])
  })
})
