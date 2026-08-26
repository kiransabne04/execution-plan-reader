import { describe, expect, it } from "vitest"
import { summarizePlan } from "../summarize"
import { applyRules } from "../index"
import { buildPlanContext } from "../types"
import { makeNode } from "./testHelpers"
import type { PlanNode, Warning } from "../../parsers/normalize"

function withWarnings(node: PlanNode, warnings: Warning[]): PlanNode {
  node.warnings = warnings
  return node
}

function warning(overrides: Partial<Warning>): Warning {
  return {
    ruleId: "test-rule",
    severity: "warning",
    shortText: "Something happened.",
    longText: "Something happened, in detail.",
    ...overrides,
  }
}

describe("summarizePlan", () => {
  it("degrades gracefully to a reassuring message when zero warnings fired", () => {
    const root = makeNode({})
    const summary = summarizePlan(root)
    expect(summary.severity).toBe("none")
    expect(summary.topFindings).toEqual([])
    expect(summary.text).toMatch(/straightforward/i)
    expect(summary.text).not.toMatch(/error|undefined|null/i)
  })

  it("synthesizes a single finding into one sentence with a severity-appropriate opener", () => {
    const root = withWarnings(
      makeNode({}),
      [warning({ ruleId: "disk-spill", severity: "critical", shortText: "Spilled to disk." })],
    )
    const summary = summarizePlan(root)
    expect(summary.severity).toBe("critical")
    expect(summary.text).toBe("This plan has a serious issue worth fixing first: spilled to disk.")
  })

  it("joins two unrelated findings with 'and', not a bare list", () => {
    const a = withWarnings(makeNode({ id: "a" }), [warning({ ruleId: "disk-spill", severity: "critical", shortText: "Spilled to disk." })])
    const b = withWarnings(makeNode({ id: "b" }), [warning({ ruleId: "high-loop-count", severity: "warning", shortText: "Runs 5000 times." })])
    const root = withWarnings(makeNode({ id: "root", children: [a, b] }), [])
    const summary = summarizePlan(root)
    expect(summary.text).toContain("spilled to disk, and runs 5000 times.")
    expect(summary.text).not.toContain("\n") // one paragraph, not a list
  })

  it("synthesizes a related scan -> downstream-effect pair as a causal sentence, not two disjoint facts", () => {
    const scan = withWarnings(
      makeNode({ id: "scan" }),
      [warning({ ruleId: "seq-scan-on-large-table", severity: "warning", shortText: "Full scan of orders." })],
    )
    const join = withWarnings(
      makeNode({ id: "join", children: [scan] }),
      [warning({ ruleId: "exploding-join", severity: "warning", shortText: "Output explodes 50x." })],
    )
    const summary = summarizePlan(join)
    expect(summary.text).toContain("which likely contributes to")
  })

  it("does NOT use causal phrasing for an unrelated scan + downstream-effect pair (different subtrees)", () => {
    const scan = withWarnings(makeNode({ id: "scan" }), [warning({ ruleId: "seq-scan-on-large-table", severity: "warning" })])
    const join = withWarnings(makeNode({ id: "join" }), [warning({ ruleId: "exploding-join", severity: "warning" })])
    const root = makeNode({ id: "root", children: [scan, join] })
    const summary = summarizePlan(root)
    expect(summary.text).not.toContain("which likely contributes to")
    expect(summary.text).toContain("and")
  })

  it("caps at the top 3 findings and dedupes repeated instances of the same rule family", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "missing-index-opportunity-0", severity: "info" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "missing-index-opportunity-1", severity: "info" })]),
      withWarnings(makeNode({ id: "n2" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n3" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
      withWarnings(makeNode({ id: "n4" }), [warning({ ruleId: "high-loop-count", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    const summary = summarizePlan(root)
    expect(summary.topFindings).toHaveLength(3)
    // Highest severity first: disk-spill (critical) leads.
    expect(summary.topFindings[0].ruleId).toBe("disk-spill")
    const families = summary.topFindings.map((w) => w.ruleId.replace(/-\d+$/, ""))
    expect(new Set(families).size).toBe(families.length) // no duplicate family in the top 3
  })

  it("uses the info opener when the highest surviving severity is info", () => {
    const root = withWarnings(makeNode({}), [warning({ ruleId: "parameter-sensitivity-honesty-note", severity: "info" })])
    expect(summarizePlan(root).text).toMatch(/^This plan looks mostly fine/)
  })

  it("never throws and never leaks 'undefined'/'NaN' regardless of odd shortText content", () => {
    const root = withWarnings(makeNode({}), [warning({ shortText: "" }), warning({ ruleId: "x", shortText: "." })])
    expect(() => summarizePlan(root)).not.toThrow()
    expect(summarizePlan(root).text).not.toMatch(/undefined|NaN/)
  })

  it("end-to-end regression snapshot: full multi-issue plan through applyRules -> summarizePlan", () => {
    const inner = makeNode({
      id: "scan",
      operatorType: "seq_scan",
      rawOperatorLabel: "Seq Scan",
      estimatedRows: 100,
      actualRows: 500_000,
      attributes: { "Relation Name": "events" },
    })
    const join = makeNode({
      id: "join",
      operatorType: "hash_join",
      rawOperatorLabel: "Hash Join",
      estimatedRows: 100,
      actualRows: 490_000,
      children: [inner, makeNode({ id: "other-side", actualRows: 10 })],
    })
    applyRules(join, buildPlanContext(join))
    expect(summarizePlan(join)).toMatchSnapshot()
  })

  it("regression snapshot: zero-warning plan", () => {
    const root = makeNode({ operatorType: "seq_scan", actualRows: 5 })
    applyRules(root, buildPlanContext(root))
    expect(summarizePlan(root)).toMatchSnapshot()
  })
})
