import { describe, expect, it } from "vitest"
import { collectAllFindings } from "../findings"
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
