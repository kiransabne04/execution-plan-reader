import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { FindingsList } from "../findings/FindingsList"
import { makeNode } from "../../rules/__tests__/testHelpers"
import type { PlanNode, Warning } from "../../parsers/normalize"
import type { FindingsSource } from "../../rules/findings"

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

/** Single-statement convenience wrapper — the common case (Postgres,
 * Snowflake, most SQL Server input), and what every pre-Story-20.4 test
 * below is really exercising. */
function single(root: PlanNode): FindingsSource[] {
  return [{ statementIndex: 0, statementLabel: "Statement 1", root }]
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
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-list")).toHaveTextContent("Problems")
    expect(screen.getByTestId("findings-list")).toHaveTextContent("5")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(5)
  })

  it("shows the 'looks fine' message when there are zero findings, reusing Story 5.2's copy", () => {
    const root = makeNode({})
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-list-empty")).toHaveTextContent(/straightforward/i)
    expect(screen.queryByTestId("finding-item")).not.toBeInTheDocument()
  })

  it("clicking a finding entry calls onSelectNode with its statement index and the originating node's id", () => {
    const flagged = withWarnings(makeNode({ id: "flagged" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const root = makeNode({ id: "root", children: [flagged] })
    const onSelectNode = vi.fn()
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={onSelectNode} />)

    fireEvent.click(screen.getByTestId("finding-item"))
    expect(onSelectNode).toHaveBeenCalledWith(0, "flagged")
  })

  it("filters by severity", () => {
    const nodes = [
      withWarnings(makeNode({ id: "n0" }), [warning({ ruleId: "disk-spill", severity: "critical" })]),
      withWarnings(makeNode({ id: "n1" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })]),
    ]
    const root = makeNode({ id: "root", children: nodes })
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

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
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-category-filter"), { target: { value: "Spill issues" } })
    const items = screen.getAllByTestId("finding-item")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("Spill issues")
  })

  it("shows a 'no findings match' message rather than an empty blank area when filters exclude everything", () => {
    const root = withWarnings(makeNode({}), [warning({ ruleId: "disk-spill", severity: "critical" })])
    render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "info" } })
    expect(screen.getByTestId("findings-list-no-match")).toBeInTheDocument()
  })

  it("preserves filter state when the same plan re-renders (e.g. after navigating to a node and back)", () => {
    const root = withWarnings(makeNode({}), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const { rerender } = render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })

    // Same root object identity — simulates a re-render caused by something
    // else in the tree (e.g. the detail panel opening/closing), not a new plan.
    rerender(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    expect(screen.getByTestId("findings-severity-filter")).toHaveValue("critical")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
  })

  it("resets filter state when a genuinely new plan (different root identity) is passed in", () => {
    const firstRoot = withWarnings(makeNode({ id: "first" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
    const { rerender } = render(<FindingsList sources={single(firstRoot)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })

    const secondRoot = withWarnings(makeNode({ id: "second" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })])
    rerender(<FindingsList sources={single(secondRoot)} activeStatementIndex={0} onSelectNode={vi.fn()} />)

    // Filter reset and the new plan's own single finding shows — a fresh
    // plan shouldn't inherit the previous plan's filter state.
    expect(screen.getByTestId("findings-severity-filter")).toHaveValue("all")
    expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
  })

  // Story 20.4 — the whole point of this story: findings across every
  // statement in the batch, not just whichever one happens to be active.
  describe("multi-statement batch (Story 20.4)", () => {
    function multi(): FindingsSource[] {
      const a = withWarnings(makeNode({ id: "a" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
      const b = withWarnings(makeNode({ id: "b" }), [warning({ ruleId: "bad-row-estimate", severity: "warning" })])
      const c = makeNode({ id: "c" }) // clean statement, no findings
      return [
        { statementIndex: 0, statementLabel: "SELECT * FROM Orders", root: a },
        { statementIndex: 1, statementLabel: "SELECT * FROM Customers", root: b },
        { statementIndex: 2, statementLabel: "DECLARE @x INT", root: c },
      ]
    }

    it("shows findings from every statement, not just the active one", () => {
      render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      expect(screen.getByTestId("findings-list")).toHaveTextContent("2")
      expect(screen.getAllByTestId("finding-item")).toHaveLength(2)
    })

    it("labels a finding from a DIFFERENT statement with that statement's label", () => {
      render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      const badges = screen.getAllByTestId("finding-statement-badge")
      expect(badges).toHaveLength(1) // only the ONE finding not on the active statement gets a badge
      expect(badges[0]).toHaveTextContent("SELECT * FROM Customers")
    })

    it("does NOT label a finding that belongs to the currently active statement", () => {
      render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      const items = screen.getAllByTestId("finding-item")
      const activeItem = items.find((item) => item.textContent?.includes("Something happened") && !item.querySelector('[data-testid="finding-statement-badge"]'))
      expect(activeItem).toBeDefined()
    })

    it("clicking a finding from a different statement passes THAT statement's index, not the active one", () => {
      const onSelectNode = vi.fn()
      render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={onSelectNode} />)
      const items = screen.getAllByTestId("finding-item")
      const bItem = items.find((item) => item.textContent?.includes("SELECT * FROM Customers"))!
      fireEvent.click(bItem)
      expect(onSelectNode).toHaveBeenCalledWith(1, "b")
    })

    it("never shows statement badges at all for a single-statement batch — identical to pre-Story-20.4 rendering", () => {
      const root = withWarnings(makeNode({ id: "n" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
      render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      expect(screen.queryByTestId("finding-statement-badge")).not.toBeInTheDocument()
    })

    it("dedupes the plan-wide honesty notes across statements rather than repeating them per statement", () => {
      const makeStatement = (id: string) =>
        withWarnings(makeNode({ id }), [warning({ ruleId: "estimate-only-plan", severity: "info" })])
      const sources: FindingsSource[] = [0, 1, 2].map((i) => ({
        statementIndex: i,
        statementLabel: `Statement ${i}`,
        root: makeStatement(`s${i}`),
      }))
      render(<FindingsList sources={sources} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      expect(screen.getByTestId("findings-list")).toHaveTextContent("1")
      expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
    })

    it("resets filters when the SET of statement roots changes, even if the array length stays the same", () => {
      const firstSources = multi()
      const { rerender } = render(<FindingsList sources={firstSources} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })
      expect(screen.getByTestId("findings-severity-filter")).toHaveValue("critical")

      const secondSources = multi() // same shape, genuinely new root objects
      rerender(<FindingsList sources={secondSources} activeStatementIndex={0} onSelectNode={vi.fn()} />)
      expect(screen.getByTestId("findings-severity-filter")).toHaveValue("all")
    })

    // Episode 26, Story 26.3 — statement grouping, scoped to the compact
    // (drawer) variant only. `multi()` above already has exactly the
    // fixture this needs: 3 statements, one ("DECLARE @x INT") with zero
    // findings at all.
    describe("statement grouping (Story 26.3, compact variant)", () => {
      it("groups findings by statement — one group per statement that actually has a finding, never an empty group for the clean one", () => {
        render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} variant="compact" />)

        const headers = screen.getAllByTestId("findings-list-group-header")
        expect(headers).toHaveLength(2) // not 3 — "DECLARE @x INT" has no findings
        expect(headers.map((h) => h.textContent)).toEqual(
          expect.arrayContaining([expect.stringContaining("SELECT * FROM Orders"), expect.stringContaining("SELECT * FROM Customers")]),
        )
        expect(screen.queryByText(/DECLARE @x INT/)).not.toBeInTheDocument()
      })

      it("nests each statement's own findings under its own group, not mixed together", () => {
        render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} variant="compact" />)

        const groups = screen.getAllByTestId("findings-list-group")
        const ordersGroup = groups.find((g) => g.textContent?.includes("SELECT * FROM Orders"))!
        const customersGroup = groups.find((g) => g.textContent?.includes("SELECT * FROM Customers"))!
        expect(within(ordersGroup).getAllByTestId("finding-item")).toHaveLength(1)
        expect(within(customersGroup).getAllByTestId("finding-item")).toHaveLength(1)
      })

      it("falls back to a flat list, no groups, for a single-statement batch", () => {
        const root = withWarnings(makeNode({ id: "n" }), [warning({ ruleId: "disk-spill", severity: "critical" })])
        render(<FindingsList sources={single(root)} activeStatementIndex={0} onSelectNode={vi.fn()} variant="compact" />)

        expect(screen.queryByTestId("findings-list-group")).not.toBeInTheDocument()
        expect(screen.getAllByTestId("finding-item")).toHaveLength(1)
      })

      it("never groups the 'list' variant, even with multiple statements — grouping is scoped to the compact drawer", () => {
        render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} />)
        expect(screen.queryByTestId("findings-list-group")).not.toBeInTheDocument()
        expect(screen.getAllByTestId("finding-item")).toHaveLength(2)
      })

      it("collapsing a group hides its rows; expanding it again shows them", () => {
        render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} variant="compact" />)
        const ordersHeader = screen.getAllByTestId("findings-list-group-header").find((h) => h.textContent?.includes("SELECT * FROM Orders"))!
        expect(ordersHeader).toHaveAttribute("aria-expanded", "true")

        fireEvent.click(ordersHeader)
        expect(ordersHeader).toHaveAttribute("aria-expanded", "false")
        // Only the OTHER group's row remains visible.
        expect(screen.getAllByTestId("finding-item")).toHaveLength(1)

        fireEvent.click(ordersHeader)
        expect(ordersHeader).toHaveAttribute("aria-expanded", "true")
        expect(screen.getAllByTestId("finding-item")).toHaveLength(2)
      })

      it("a statement whose findings are all filtered out shows no group header for it, same as the naturally-clean statement", () => {
        render(<FindingsList sources={multi()} activeStatementIndex={0} onSelectNode={vi.fn()} variant="compact" />)
        fireEvent.change(screen.getByTestId("findings-severity-filter"), { target: { value: "critical" } })

        // Only the critical finding's own statement ("Orders") has a group now.
        const headers = screen.getAllByTestId("findings-list-group-header")
        expect(headers).toHaveLength(1)
        expect(headers[0]).toHaveTextContent("SELECT * FROM Orders")
      })
    })
  })
})
