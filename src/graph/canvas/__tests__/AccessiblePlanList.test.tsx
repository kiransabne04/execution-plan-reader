import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AccessiblePlanList } from "../AccessiblePlanList"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import type { PlanNode, Warning } from "../../../parsers/normalize"

function withWarnings(node: PlanNode, warnings: Warning[]): PlanNode {
  node.warnings = warnings
  return node
}

describe("AccessiblePlanList", () => {
  it("renders one row per node in the tree, in depth-first order", () => {
    const child = makeNode({ id: "child", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [child] })

    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    const items = screen.getAllByTestId("accessible-plan-list-item")
    expect(items.map((i) => i.getAttribute("data-node-id"))).toEqual(["root", "child"])
  })

  it("clicking a row calls onSelectNode with that node's id", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    const onSelectNode = vi.fn()
    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={onSelectNode} onExpandCollapsedGroup={vi.fn()} />)

    fireEvent.click(screen.getByTestId("accessible-plan-list-item"))
    expect(onSelectNode).toHaveBeenCalledWith("root")
  })

  // Episode 26, Story 26.1 — this list is now the universal interactive
  // path, so it needs the same explicit-focus-on-click PlanNodeCard.tsx
  // (now deleted) used to do: a mouse click doesn't reliably focus a
  // button in every browser, and PlanGraph.tsx's own focus-restore-on-
  // panel-close relies on `document.activeElement` having actually been
  // this row at click time.
  it("focuses the clicked row itself, with preventScroll — a bare click shouldn't be left to ambient browser focus behavior", () => {
    const root = makeNode({ id: "root" })
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus")
    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    const row = screen.getByTestId("accessible-plan-list-item")
    fireEvent.click(row)
    expect(document.activeElement).toBe(row)
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    focusSpy.mockRestore()
  })

  it("marks the selected node's row with aria-current", () => {
    const child = makeNode({ id: "child" })
    const root = makeNode({ id: "root", children: [child] })
    render(<AccessiblePlanList root={root} collapsedIds={new Set()} selectedNodeId="child" onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    const items = screen.getAllByTestId("accessible-plan-list-item")
    const rootRow = items.find((i) => i.getAttribute("data-node-id") === "root")!
    const childRow = items.find((i) => i.getAttribute("data-node-id") === "child")!
    expect(childRow).toHaveAttribute("aria-current", "true")
    expect(rootRow).not.toHaveAttribute("aria-current")
  })

  it("renders a collapsed-group row instead of descending into a collapsed subtree", () => {
    const hidden = makeNode({ id: "hidden-child" })
    const collapsedParent = makeNode({ id: "collapsed-parent", children: [hidden] })
    const root = makeNode({ id: "root", children: [collapsedParent] })

    render(
      <AccessiblePlanList root={root} collapsedIds={new Set(["collapsed-parent"])} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />,
    )

    expect(screen.getAllByTestId("accessible-plan-list-item")).toHaveLength(2) // root + collapsed-parent still render
    expect(screen.queryByText(/hidden-child/)).not.toBeInTheDocument()
    expect(screen.getByTestId("accessible-plan-list-collapsed")).toHaveTextContent("1 hidden node")
  })

  it("clicking the collapsed-group row calls onExpandCollapsedGroup with the parent node's id", () => {
    const collapsedParent = makeNode({ id: "collapsed-parent", children: [makeNode({ id: "hidden" })] })
    const root = makeNode({ id: "root", children: [collapsedParent] })
    const onExpandCollapsedGroup = vi.fn()

    render(
      <AccessiblePlanList
        root={root}
        collapsedIds={new Set(["collapsed-parent"])}
        onSelectNode={vi.fn()}
        onExpandCollapsedGroup={onExpandCollapsedGroup}
      />,
    )

    fireEvent.click(screen.getByTestId("accessible-plan-list-collapsed"))
    expect(onExpandCollapsedGroup).toHaveBeenCalledWith("collapsed-parent")
  })

  it("shows the worst-severity warning as a badge on a node's row", () => {
    const flagged = withWarnings(makeNode({ id: "flagged" }), [
      { ruleId: "bad-row-estimate", severity: "warning", shortText: "x", longText: "y" },
      { ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" },
    ])
    const root = makeNode({ id: "root", children: [flagged] })

    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    const badges = screen.getAllByTestId("accessible-plan-list-severity")
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent("Critical")
  })

  it("does not show a severity badge on a node with no warnings", () => {
    const root = makeNode({ id: "root" })
    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
    expect(screen.queryByTestId("accessible-plan-list-severity")).not.toBeInTheDocument()
  })

  it("renders a shared-reference node once as a normal row and again marked as a linked reference, never as a duplicated subtree", () => {
    const shared = makeNode({ id: "shared", children: [makeNode({ id: "shared-child" })] })
    const root = makeNode({ id: "root", children: [shared, shared] }) // same object, two parents

    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)

    // "shared" appears twice as a row (once real, once as a linking
    // reference) but "shared-child" — its descendant — appears only once,
    // since the second occurrence must not re-descend into a duplicate copy.
    const sharedRows = screen.getAllByTestId("accessible-plan-list-item").filter((i) => i.getAttribute("data-node-id") === "shared")
    expect(sharedRows).toHaveLength(2)
    const childRows = screen.getAllByTestId("accessible-plan-list-item").filter((i) => i.getAttribute("data-node-id") === "shared-child")
    expect(childRows).toHaveLength(1)
  })

  it("renders nothing but the root row for a single-node plan, without crashing", () => {
    const root = makeNode({ id: "solo" })
    render(<AccessiblePlanList root={root} collapsedIds={new Set()} onSelectNode={vi.fn()} onExpandCollapsedGroup={vi.fn()} />)
    expect(screen.getAllByTestId("accessible-plan-list-item")).toHaveLength(1)
  })
})
