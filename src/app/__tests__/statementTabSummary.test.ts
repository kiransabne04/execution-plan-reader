import { describe, expect, it } from "vitest"
import { formatStatementDuration, statementSeverity, isTrivialStatement, buildStatementTabRows } from "../statementTabSummary"
import { makeNode } from "../../rules/__tests__/testHelpers"
import type { PlanNode } from "../../parsers/normalize"

describe("formatStatementDuration", () => {
  it("prefers actualTimeMs when present", () => {
    const root = makeNode({ actualTimeMs: 8.42, estimatedCost: 100 })
    expect(formatStatementDuration(root)).toBe("8.4ms")
  })

  it("falls back to estimatedCost when actualTimeMs is absent", () => {
    const root = makeNode({ actualTimeMs: undefined, estimatedCost: 12.6 })
    expect(formatStatementDuration(root)).toBe("cost 13")
  })

  it("returns undefined rather than fabricating a figure when neither is present", () => {
    const root = makeNode({ actualTimeMs: undefined, estimatedCost: undefined })
    expect(formatStatementDuration(root)).toBeUndefined()
  })
})

describe("statementSeverity", () => {
  it("returns the worst severity across the whole tree", () => {
    const warningNode = makeNode({
      id: "a",
      warnings: [{ ruleId: "x", severity: "warning", shortText: "x", longText: "y" }],
    })
    const criticalNode = makeNode({
      id: "b",
      warnings: [{ ruleId: "y", severity: "critical", shortText: "x", longText: "y" }],
    })
    const root = makeNode({ id: "root", children: [warningNode, criticalNode] })
    expect(statementSeverity(root)).toBe("critical")
  })

  it("returns undefined for a clean statement", () => {
    const root = makeNode({ id: "root" })
    expect(statementSeverity(root)).toBeUndefined()
  })

  it("returns undefined when every finding is info-tier — a note doesn't earn a tab dot, same rule the severity ring already follows", () => {
    const infoNode = makeNode({
      id: "a",
      warnings: [{ ruleId: "z", severity: "info", shortText: "x", longText: "y" }],
    })
    const root = makeNode({ id: "root", children: [infoNode] })
    expect(statementSeverity(root)).toBeUndefined()
  })
})

describe("isTrivialStatement", () => {
  it("is trivial when there's no finding and no cost/duration figure at all", () => {
    expect(isTrivialStatement(makeNode({ estimatedCost: undefined, actualTimeMs: undefined }))).toBe(true)
  })

  it("is trivial when there's no finding and cost rounds to exactly 0", () => {
    expect(isTrivialStatement(makeNode({ estimatedCost: 0.2, actualTimeMs: undefined }))).toBe(true)
  })

  it("is NOT trivial when a real cost is present", () => {
    expect(isTrivialStatement(makeNode({ estimatedCost: 12.6, actualTimeMs: undefined }))).toBe(false)
  })

  it("is NOT trivial when the statement has a warning/critical finding, even at cost 0", () => {
    const warningNode = makeNode({
      id: "a",
      estimatedCost: 0,
      warnings: [{ ruleId: "x", severity: "warning", shortText: "x", longText: "y" }],
    })
    expect(isTrivialStatement(warningNode)).toBe(false)
  })
})

describe("buildStatementTabRows", () => {
  const trivial = () => makeNode({ estimatedCost: 0, actualTimeMs: undefined })
  const real = (cost: number) => makeNode({ estimatedCost: cost, actualTimeMs: undefined })

  it("keeps a non-trivial statement, and a LONE trivial one, as plain tabs", () => {
    const roots: PlanNode[] = [real(10), trivial(), real(20)]
    expect(buildStatementTabRows(roots, 0)).toEqual([
      { kind: "tab", index: 0 },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 2 },
    ])
  })

  it("collapses a run of 2+ consecutive trivial statements into one group row (expanded: false)", () => {
    const roots: PlanNode[] = [real(10), trivial(), trivial(), trivial(), real(20)]
    expect(buildStatementTabRows(roots, 0)).toEqual([
      { kind: "tab", index: 0 },
      { kind: "group", start: 1, length: 3, expanded: false },
      { kind: "tab", index: 4 },
    ])
  })

  // Story 20.3: an expanded run keeps its OWN group row (expanded: true)
  // right before the tabs it reveals — the only way back to collapsed,
  // since without it the expand button vanished the moment it was clicked.
  it("pre-expands a run that contains the active statement index — a restored selection is never hidden — and keeps a collapse control", () => {
    const roots: PlanNode[] = [real(10), trivial(), trivial(), trivial(), real(20)]
    expect(buildStatementTabRows(roots, 2)).toEqual([
      { kind: "tab", index: 0 },
      { kind: "group", start: 1, length: 3, expanded: true },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 2 },
      { kind: "tab", index: 3 },
      { kind: "tab", index: 4 },
    ])
  })

  it("expands a run the caller marked expanded, regardless of active index, and keeps a collapse control", () => {
    const roots: PlanNode[] = [real(10), trivial(), trivial(), real(20)]
    expect(buildStatementTabRows(roots, 0, new Set([1]))).toEqual([
      { kind: "tab", index: 0 },
      { kind: "group", start: 1, length: 2, expanded: true },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 2 },
      { kind: "tab", index: 3 },
    ])
  })

  it("an all-trivial batch never renders empty — the default active index (0) falls inside the sole run, so it renders already-expanded (with a collapse control) rather than a hidden group", () => {
    const roots: PlanNode[] = [trivial(), trivial(), trivial()]
    expect(buildStatementTabRows(roots, 0)).toEqual([
      { kind: "group", start: 0, length: 3, expanded: true },
      { kind: "tab", index: 0 },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 2 },
    ])
  })

  it("collapsing back removes the run's start from expandedRunStarts and it renders collapsed again, UNLESS the active index still sits inside it", () => {
    const roots: PlanNode[] = [real(10), trivial(), trivial(), real(20)]
    // Expanded via expandedRunStarts, active index elsewhere — an empty
    // expandedRunStarts (simulating the user clicking "Collapse") returns
    // to the collapsed group row.
    expect(buildStatementTabRows(roots, 0, new Set())).toEqual([
      { kind: "tab", index: 0 },
      { kind: "group", start: 1, length: 2, expanded: false },
      { kind: "tab", index: 3 },
    ])
  })

  it("a run forced open by the active index stays expanded even after 'collapsing' (expandedRunStarts empty) — the active tab is never hidden", () => {
    const roots: PlanNode[] = [real(10), trivial(), trivial(), real(20)]
    expect(buildStatementTabRows(roots, 1, new Set())).toEqual([
      { kind: "tab", index: 0 },
      { kind: "group", start: 1, length: 2, expanded: true },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 2 },
      { kind: "tab", index: 3 },
    ])
  })
})
