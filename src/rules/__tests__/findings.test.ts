import { describe, expect, it } from "vitest"
import { collectAllFindings, collectFindingsAcrossStatements, type FindingsSource } from "../findings"
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

describe("collectAllFindings", () => {
  it("returns an empty list for a plan with zero warnings", () => {
    const root = makeNode({})
    expect(collectAllFindings(root)).toEqual([])
  })

  it("includes every finding across every node — no cap, no family dedup", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "missing-index-opportunity-0", severity: "info" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "missing-index-opportunity-1", severity: "info" })]),
      withWarnings(makeNode({ id: "n2" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n3" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
      withWarnings(makeNode({ id: "n4" }), [warning({ ruleId: "high-loop-count", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    // Same shape summarize.test.ts's "caps at top 3" fixture uses — this
    // list, unlike the summary, must retain all 5 with no family collapse.
    expect(collectAllFindings(root)).toHaveLength(5)
  })

  it("keeps multiple warnings on the same node as separate entries", () => {
    const node = withWarnings(makeNode({ id: "n" }), [
      warning({ ruleId: "disk-spill", severity: "critical" }),
      warning({ ruleId: "high-loop-count", severity: "warning" }),
    ])
    const findings = collectAllFindings(node)
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.nodeId === "n")).toBe(true)
  })

  it("sorts by severity, critical first", () => {
    const nodes = [
      withWarnings(makeNode({ id: "info-node" }), [warning({ ruleId: "parameter-sensitivity-honesty-note", severity: "info" })]),
      withWarnings(makeNode({ id: "critical-node" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "warning-node" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    const findings = collectAllFindings(root)
    expect(findings.map((f) => f.warning.severity)).toEqual(["critical", "warning", "info"])
  })

  it("attaches a category derived from the rule family, stripping the per-instance numeric suffix", () => {
    const node = withWarnings(makeNode({ id: "n" }), [warning({ ruleId: "missing-index-opportunity-3", severity: "info" })])
    const [finding] = collectAllFindings(node)
    expect(finding.category).toBe("Index issues")
  })

  it("falls back to 'General notes' for an unrecognized ruleId rather than throwing", () => {
    const node = withWarnings(makeNode({ id: "n" }), [warning({ ruleId: "some-future-rule", severity: "info" })])
    const [finding] = collectAllFindings(node)
    expect(finding.category).toBe("General notes")
  })

  it("each finding records the id of the node it came from, for navigation back to it", () => {
    const flagged = withWarnings(makeNode({ id: "flagged" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const root = makeNode({ id: "root", children: [flagged, makeNode({ id: "clean" })] })
    const findings = collectAllFindings(root)
    expect(findings).toHaveLength(1)
    expect(findings[0].nodeId).toBe("flagged")
  })
})

describe("collectFindingsAcrossStatements", () => {
  function source(statementIndex: number, root: PlanNode, statementLabel = `stmt-${statementIndex}`): FindingsSource {
    return { statementIndex, statementLabel, root }
  }

  it("returns an empty list when no statement has any finding", () => {
    const sources = [source(0, makeNode({})), source(1, makeNode({}))]
    expect(collectFindingsAcrossStatements(sources)).toEqual([])
  })

  it("merges findings from every statement, each tagged with its own statementIndex/statementLabel", () => {
    const a = withWarnings(makeNode({ id: "a" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const b = withWarnings(makeNode({ id: "b" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })])
    const sources = [source(0, a, "Statement A"), source(1, b, "Statement B")]
    const findings = collectFindingsAcrossStatements(sources)
    expect(findings).toHaveLength(2)
    expect(findings.find((f) => f.nodeId === "a")).toMatchObject({ statementIndex: 0, statementLabel: "Statement A" })
    expect(findings.find((f) => f.nodeId === "b")).toMatchObject({ statementIndex: 1, statementLabel: "Statement B" })
  })

  it("sorts merged findings by severity across statements, not grouped by statement first", () => {
    const infoFirst = withWarnings(makeNode({ id: "info" }), [warning({ ruleId: "some-info-rule", severity: "info" })])
    const criticalSecond = withWarnings(makeNode({ id: "crit" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const sources = [source(0, infoFirst), source(1, criticalSecond)]
    const findings = collectFindingsAcrossStatements(sources)
    expect(findings.map((f) => f.warning.severity)).toEqual(["critical", "info"])
  })

  // The exact scenario this story fixes: a large stored-proc batch repeats
  // the same two plan-wide honesty notes on every statement's own root.
  it("dedupes plan-wide honesty notes (parameter-sensitivity, estimate-only) across statements instead of repeating them per statement", () => {
    const makeStatement = (id: string) =>
      withWarnings(makeNode({ id }), [
        warning({ ruleId: "parameter-sensitivity-honesty-note", severity: "info" }),
        warning({ ruleId: "estimate-only-plan", severity: "info" }),
      ])
    const sources = [0, 1, 2, 3, 4].map((i) => source(i, makeStatement(`s${i}`)))
    const findings = collectFindingsAcrossStatements(sources)
    // 5 statements × 2 plan-wide notes each would naively be 10 — deduped
    // down to exactly 2 (one per rule), not zero and not 10.
    expect(findings).toHaveLength(2)
    expect(findings.map((f) => f.warning.ruleId).sort()).toEqual(["estimate-only-plan", "parameter-sensitivity-honesty-note"])
  })

  it("keeps the FIRST occurrence (lowest statementIndex) of a deduped plan-wide note, not an arbitrary one", () => {
    const makeStatement = (id: string) => withWarnings(makeNode({ id }), [warning({ ruleId: "estimate-only-plan", severity: "info" })])
    const sources = [source(3, makeStatement("later")), source(0, makeStatement("earlier"))] // deliberately out of index order
    const findings = collectFindingsAcrossStatements(sources)
    expect(findings).toHaveLength(1)
    expect(findings[0].statementIndex).toBe(3) // first in ARRAY order, not sorted by index — caller controls order
  })

  it("does NOT dedupe a real per-statement finding that happens to share a ruleId across statements — only the two plan-wide rule ids are special-cased", () => {
    const makeStatement = (id: string) => withWarnings(makeNode({ id }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const sources = [source(0, makeStatement("s0")), source(1, makeStatement("s1"))]
    const findings = collectFindingsAcrossStatements(sources)
    expect(findings).toHaveLength(2) // a real spill on TWO different statements is two real findings, not a dup
  })

  it("behaves identically to collectAllFindings for a single-statement batch (the common case)", () => {
    const root = withWarnings(makeNode({ id: "n" }), [
      warning({ ruleId: "parameter-sensitivity-honesty-note", severity: "info" }),
      warning({ ruleId: "disk-spill", severity: "critical" }),
    ])
    const single = collectAllFindings(root)
    const batch = collectFindingsAcrossStatements([source(0, root)])
    expect(batch.map((f) => ({ nodeId: f.nodeId, ruleId: f.warning.ruleId }))).toEqual(
      single.map((f) => ({ nodeId: f.nodeId, ruleId: f.warning.ruleId })),
    )
  })

  it("handles an empty sources array without throwing", () => {
    expect(collectFindingsAcrossStatements([])).toEqual([])
  })
})
