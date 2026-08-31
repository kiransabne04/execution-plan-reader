import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FindingsList } from "../findings/FindingsList"
import { makeNode } from "../../rules/__tests__/testHelpers"
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

describe("FindingsList", () => {
  it("shows the header count and every finding directly — no collapse-behind-a-toggle (design review)", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "missing-index-opportunity-0", severity: "info" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "missing-index-opportunity-1", severity: "info" })]),
      withWarnings(makeNode({ id: "n2" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n3" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
      withWarnings(makeNode({ id: "n4" }), [warning({ ruleId: "high-loop-count", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-list")).toHaveTextContent("Findings")
    expect(screen.getByTestId("findings-list")).toHaveTextContent("5")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(5)
  })

  it("shows the 'looks fine' message when there are zero findings, reusing Story 5.2's copy", () => {
    const root = makeNode({})
    render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-list-empty")).toHaveTextContent(/straightforward/i)
    expect(screen.queryByTestId("finding-item")).not.toBeInTheDocument()
  })

  it("clicking a finding entry calls onSelectNode with the originating node's id", () => {
    const flagged = withWarnings(makeNode({ id: "flagged" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const root = makeNode({ id: "root", children: [flagged] })
    const onSelectNode = vi.fn()
    render(<FindingsList root={root} onSelectNode={onSelectNode} />)

    fireEvent.click(screen.getByTestId("finding-item"))
    expect(onSelectNode).toHaveBeenCalledWith("flagged")
  })

  it("filters by severity", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    expect(screen.getAllByTestId("finding-item")).toHaveLength(2)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })
    const items = screen.getAllByTestId("finding-item")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("Critical")
  })

  it("filters by category", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "high-loop-count", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-category-filter"), { target: { value: "Spill issues" } })
    const items = screen.getAllByTestId("finding-item")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("Spill issues")
  })

  it("shows a 'no findings match' message rather than an empty blank area when filters exclude everything", () => {
    const root = withWarnings(makeNode({}), [warning({ ruleId: "disk-spill", severity: "critical" })])
    render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "info" } })
    expect(screen.getByTestId("findings-list-no-match")).toBeInTheDocument()
  })

  it("preserves filter state when the same plan re-renders (e.g. after navigating to a node and back)", () => {
    const root = withWarnings(makeNode({}), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const { rerender } = render(<FindingsList root={root} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })

    // Same root object identity — simulates a re-render caused by something
    // else in the tree (e.g. the detail panel opening/closing), not a new plan.
    rerender(<FindingsList root={root} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-severity-filter")).toHaveValue("critical")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
  })

  it("resets filter state when a genuinely new plan (different root identity) is passed in", () => {
    const firstRoot = withWarnings(makeNode({ id: "first" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const { rerender } = render(<FindingsList root={firstRoot} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })

    const secondRoot = withWarnings(makeNode({ id: "second" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })])
    rerender(<FindingsList root={secondRoot} onSelectNode={vi.fn()} />)

    // Filter reset and the new plan's own single finding shows — a fresh
    // plan shouldn't inherit the previous plan's filter state.
    expect(screen.getByTestId("findings-severity-filter")).toHaveValue("all")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
  })
})
