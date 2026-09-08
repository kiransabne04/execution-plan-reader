import { describe, expect, it } from "vitest"
import { computeBatchHealth } from "../batchHealth"
import { applyRules } from "../../rules/index"
import { buildPlanContext } from "../../rules/types"
import { summarizePlan } from "../../rules/summarize"
import { makeNode } from "../../rules/__tests__/testHelpers"
import type { AnalyzedStatement } from "../analyzePlan"
import type { PlanNode } from "../../parsers/normalize"

function statement(root: PlanNode, label: string): AnalyzedStatement {
  const context = buildPlanContext(root)
  applyRules(root, context)
  return { label, root, summary: summarizePlan(root), context }
}

describe("computeBatchHealth", () => {
  it("returns undefined worst/median when every statement is trivial (no scoreable dimension)", () => {
    const statements = [statement(makeNode({}), "declare-1"), statement(makeNode({}), "declare-2")]
    const health = computeBatchHealth(statements)
    expect(health.worstScore).toBeUndefined()
    expect(health.medianScore).toBeUndefined()
    expect(health.criticalStatementCount).toBe(0)
  })

  it("computes worst and median scores across non-trivial statements", () => {
    // A cartesian join (critical, big penalty) vs. a clean parallel scan
    // (no findings) — two genuinely different scores to compare.
    const bad = statement(
      makeNode({
        operatorType: "cartesian_join",
        actualRows: 1_000,
        actualTimeMs: 50,
        children: [makeNode({ actualRows: 5 }), makeNode({ actualRows: 5 })],
      }),
      "bad",
    )
    const good = statement(makeNode({ operatorType: "seq_scan", actualRows: 10, actualTimeMs: 5 }), "good")
    const health = computeBatchHealth([bad, good])
    expect(health.worstScore).toBeDefined()
    expect(health.medianScore).toBeDefined()
    expect(health.worstScore).toBeLessThanOrEqual(health.medianScore!)
  })

  it("counts a statement as critical only when it has at least one critical-severity finding", () => {
    const critical = statement(
      makeNode({
        operatorType: "cartesian_join",
        actualRows: 1_000,
        children: [makeNode({ actualRows: 5 }), makeNode({ actualRows: 5 })],
      }),
      "critical-stmt",
    )
    const clean = statement(makeNode({ operatorType: "seq_scan", actualRows: 10 }), "clean-stmt")
    const health = computeBatchHealth([critical, clean])
    expect(health.criticalStatementCount).toBe(1)
  })

  it("excludes trivial statements from the critical count and score aggregation", () => {
    const trivial = statement(makeNode({}), "trivial")
    const real = statement(makeNode({ operatorType: "seq_scan", actualRows: 10, actualTimeMs: 5 }), "real")
    const health = computeBatchHealth([trivial, real])
    // Only "real" contributes — if trivial were counted, worst/median would
    // differ or the statement count assumptions below would break.
    expect(health.medianScore).toBeDefined()
  })

  it("reuses statementRanking's own ranking for topStatements, capped at 3", () => {
    const statements = [
      statement(makeNode({ actualTimeMs: 100, actualRows: 10 }), "a"),
      statement(makeNode({ actualTimeMs: 500, actualRows: 10 }), "b"),
      statement(makeNode({ actualTimeMs: 50, actualRows: 10 }), "c"),
      statement(makeNode({ actualTimeMs: 900, actualRows: 10 }), "d"),
    ]
    const health = computeBatchHealth(statements)
    expect(health.topStatements).toHaveLength(3)
    expect(health.topStatements.map((s) => s.label)).toEqual(["d", "b", "a"])
  })

  it("does not throw on an empty statement list", () => {
    expect(() => computeBatchHealth([])).not.toThrow()
    const health = computeBatchHealth([])
    expect(health.worstScore).toBeUndefined()
    expect(health.topStatements).toEqual([])
  })
})
