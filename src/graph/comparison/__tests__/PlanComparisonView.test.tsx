import { describe, expect, it } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { PlanComparisonView } from "../PlanComparisonView"
import { makeNode } from "../../../rules/__tests__/testHelpers"

/**
 * A changed node (orders: seq_scan -> index_scan) plus a genuinely-added
 * node (regions), with no positional coincidence between them: Plan A has
 * only 2 children (ordinals 0-1), Plan B has 3 (0-2) — B's ordinal-2 slot
 * has no A counterpart at any phase, so `matchNodes`'s positional-only
 * fallback (matchNodes.ts phase 3) never gets a candidate to pair it with.
 * Deliberately NOT combined with a removed node here — a same-position,
 * same-operator-type leftover on both sides is exactly matchNodes' own
 * documented "self-join touching the same table twice" ambiguity case, and
 * this fixture is built to avoid tripping it, not exercise it.
 */
function buildChangedAndAddedPlans() {
  const planA = makeNode({
    id: "a-join",
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Join",
    children: [
      makeNode({ id: "a-scan-orders", operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", attributes: { "Relation Name": "orders" } }),
    ],
  })
  const planB = makeNode({
    id: "b-join",
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Join",
    children: [
      makeNode({
        id: "b-scan-orders",
        operatorType: "index_scan",
        rawOperatorLabel: "Index Scan",
        attributes: { "Relation Name": "orders", "Index Name": "idx_orders" },
        index: { name: "idx_orders" },
      }),
      makeNode({
        id: "b-scan-regions",
        operatorType: "seq_scan",
        rawOperatorLabel: "Seq Scan",
        attributes: { "Relation Name": "regions" },
      }),
    ],
  })
  return { planA, planB }
}

/** Mirror image of the above, for a clean removedFromB case: Plan A has the
 * extra ordinal-1 child (regions), Plan B has only the one both share. */
function buildRemovedPlans() {
  const planA = makeNode({
    id: "a-join",
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Join",
    children: [
      makeNode({ id: "a-scan-orders", operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", attributes: { "Relation Name": "orders" } }),
      makeNode({
        id: "a-scan-regions",
        operatorType: "seq_scan",
        rawOperatorLabel: "Seq Scan",
        attributes: { "Relation Name": "regions" },
      }),
    ],
  })
  const planB = makeNode({
    id: "b-join",
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Join",
    children: [
      makeNode({ id: "b-scan-orders", operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", attributes: { "Relation Name": "orders" } }),
    ],
  })
  return { planA, planB }
}

/** Episode 26, Story 26.1 — canvas is now the only rendering path, so a
 * plan node is no longer a real DOM element with its own `data-node-id`;
 * the accessible list (Story 15.2, now the universal keyboard/screen-
 * reader path — see AccessiblePlanList.tsx's own comment) is this test
 * file's deterministic, testid-based way to select a specific node in a
 * specific pane, exercising PlanComparisonView's real synced-selection
 * wiring end to end rather than reaching into canvas hit-testing pixel
 * math (already covered in isolation by CanvasPlanGraph.test.tsx). */
function getPanes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".plan-comparison-view__pane"))
}

function clickNodeInPane(pane: HTMLElement, nodeId: string) {
  fireEvent.click(within(pane).getByTestId("accessible-list-toggle"))
  const row = within(pane)
    .getAllByTestId("accessible-plan-list-item")
    .find((r) => r.getAttribute("data-node-id") === nodeId)!
  fireEvent.click(row)
}

describe("PlanComparisonView", () => {
  it("renders both panes and a plain-language summary strip", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    expect(screen.getByText("Before")).toBeInTheDocument()
    expect(screen.getByText("After")).toBeInTheDocument()
    const summary = screen.getByTestId("comparison-summary")
    expect(within(summary).getByText(/1 node changed, 1 added, 0 removed/)).toBeInTheDocument()
  })

  // The comparison-delta TEXT itself ("Seq Scan → Index Scan (...)") is a
  // canvas-drawn detail now, verified at the unit level in
  // canvasDraw.test.ts (drawGraph reads the same comparisonOverlay data
  // this view builds) — this test stays at PlanComparisonView's own level
  // of concern: did it classify the right nodes as changed/added at all,
  // via the accessible list's real (DOM, testable) comparison badge.
  it("marks a changed node with a comparison badge, and an added node distinctly", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} />)

    for (const pane of getPanes()) fireEvent.click(within(pane).getByTestId("accessible-list-toggle"))
    const badges = screen.getAllByTestId("accessible-plan-list-comparison")
    expect(badges.map((b) => b.textContent)).toEqual(expect.arrayContaining(["Changed", "Added"]))
  })

  it("marks a removed node with a distinct comparison badge", () => {
    const { planA, planB } = buildRemovedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} />)

    for (const pane of getPanes()) fireEvent.click(within(pane).getByTestId("accessible-list-toggle"))
    const badges = screen.getAllByTestId("accessible-plan-list-comparison")
    expect(badges.map((b) => b.textContent)).toContain("Removed")
  })

  it("clicking a matched node in Plan A selects and opens its counterpart in Plan B", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    // The join root is a stable identity match on both sides (no relation,
    // same depth/ordinal) — click it in Plan A.
    clickNodeInPane(getPanes()[0], "a-join")

    // Both detail panels (one per pane) should now be open on their
    // respective matched node.
    const panels = screen.getAllByTestId("detail-panel")
    expect(panels).toHaveLength(2)
    expect(screen.queryByTestId("comparison-no-match-notice")).not.toBeInTheDocument()
  })

  it("clicking a removed-in-B node shows a no-match notice instead of syncing a nonexistent counterpart", () => {
    const { planA, planB } = buildRemovedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    clickNodeInPane(getPanes()[0], "a-scan-regions")

    expect(screen.getByTestId("comparison-no-match-notice")).toHaveTextContent("No corresponding node in After.")
    // The clicked pane's own panel still opens normally — only the sync to
    // the other pane is what has no target.
    expect(screen.getAllByTestId("detail-panel")).toHaveLength(1)
  })

  it("shows a clear, specific message instead of two graphs when the plans are from different engines", () => {
    const planA = makeNode({ engine: "postgres", id: "a", operatorType: "seq_scan" })
    const planB = makeNode({ engine: "sqlserver", id: "b", operatorType: "seq_scan" })

    render(<PlanComparisonView planA={planA} planB={planB} />)

    expect(screen.queryByTestId("plan-comparison-view")).not.toBeInTheDocument()
    expect(screen.getByTestId("plan-comparison-error")).toHaveTextContent(/different database engines/)
  })

  it("toggles between side-by-side and stacked orientation", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} />)

    const container = screen.getByTestId("plan-comparison-view").querySelector(".plan-comparison-view__panes")
    expect(container?.className).not.toContain("--stacked")

    fireEvent.click(screen.getByTestId("comparison-orientation-toggle"))
    expect(container?.className).toContain("--stacked")
  })
})
