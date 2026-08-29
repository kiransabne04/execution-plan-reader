import { describe, expect, it } from "vitest"
import { formatStatementDuration, statementSeverity } from "../statementTabSummary"
import { makeNode } from "../../rules/__tests__/testHelpers"

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
