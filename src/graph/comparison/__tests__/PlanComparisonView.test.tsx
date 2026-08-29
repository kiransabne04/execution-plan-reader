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

describe("PlanComparisonView", () => {
  it("renders both panes and a plain-language summary strip", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    expect(screen.getByText("Before")).toBeInTheDocument()
    expect(screen.getByText("After")).toBeInTheDocument()
    const summary = screen.getByTestId("comparison-summary")
    expect(within(summary).getByText(/1 node changed, 1 added, 0 removed/)).toBeInTheDocument()
  })

  it("marks a changed node with a comparison badge showing the operator delta, and an added node distinctly", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} />)

    const badges = screen.getAllByTestId("comparison-badge")
    expect(badges.map((b) => b.textContent)).toEqual(expect.arrayContaining(["changed", "added"]))

    const delta = screen.getAllByTestId("comparison-delta")
    expect(delta.some((d) => d.textContent?.includes("Seq Scan → Index Scan"))).toBe(true)
  })

  it("marks a removed node with a distinct comparison badge", () => {
    const { planA, planB } = buildRemovedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} />)

    const badges = screen.getAllByTestId("comparison-badge")
    expect(badges.map((b) => b.textContent)).toContain("removed")
  })

  it("clicking a matched node in Plan A selects and opens its counterpart in Plan B", () => {
    const { planA, planB } = buildChangedAndAddedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    // The join root is a stable identity match on both sides (no relation,
    // same depth/ordinal) — click it in Plan A.
    const joinCardInA = document.querySelector("[data-node-id='a-join']") as HTMLElement
    fireEvent.click(joinCardInA)

    // Both detail panels (one per pane) should now be open on their
    // respective matched node.
    const panels = screen.getAllByTestId("detail-panel")
    expect(panels).toHaveLength(2)
    expect(screen.queryByTestId("comparison-no-match-notice")).not.toBeInTheDocument()
  })

  it("clicking a removed-in-B node shows a no-match notice instead of syncing a nonexistent counterpart", () => {
    const { planA, planB } = buildRemovedPlans()
    render(<PlanComparisonView planA={planA} planB={planB} labelA="Before" labelB="After" />)

    const removedCard = document.querySelector("[data-node-id='a-scan-regions']") as HTMLElement
    fireEvent.click(removedCard)

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
