import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanGraph } from "../PlanGraph"
import { makeNode } from "../../rules/__tests__/testHelpers"

function buildLargePlan(fillerDepth: number) {
  let filler = makeNode({ id: "deep-leaf", actualTimeMs: 0.001 })
  for (let i = 0; i < fillerDepth; i++) {
    filler = makeNode({ id: `filler-${i}`, actualTimeMs: 0.001, children: [filler] })
  }
  const expensive = makeNode({ id: "expensive", actualTimeMs: 1_000_000 })
  return makeNode({ id: "root", actualTimeMs: 0, children: [expensive, filler] })
}

describe("PlanGraph", () => {
  it("renders a card for every node in a small plan", () => {
    const leaf1 = makeNode({ id: "leaf1", rawOperatorLabel: "Seq Scan", actualRows: 100 })
    const leaf2 = makeNode({ id: "leaf2", rawOperatorLabel: "Seq Scan", actualRows: 200 })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", actualRows: 300, children: [leaf1, leaf2] })

    render(<PlanGraph root={root} />)

    const cards = screen.getAllByTestId("plan-node-card")
    expect(cards).toHaveLength(3)
    expect(new Set(cards.map((c) => c.getAttribute("data-node-id")))).toEqual(new Set(["root", "leaf1", "leaf2"]))
  })

  it("renders a single-node plan without crashing", () => {
    const root = makeNode({ id: "solo", rawOperatorLabel: "Result" })
    render(<PlanGraph root={root} />)
    expect(screen.getAllByTestId("plan-node-card")).toHaveLength(1)
  })

  it("shows a mismatch badge only on the node carrying a bad-row-estimate warning", () => {
    const flagged = makeNode({
      id: "flagged",
      warnings: [{ ruleId: "bad-row-estimate", severity: "warning", shortText: "x", longText: "y" }],
    })
    const clean = makeNode({ id: "clean" })
    const root = makeNode({ id: "root", children: [flagged, clean] })

    render(<PlanGraph root={root} />)

    expect(screen.getAllByTestId("mismatch-badge")).toHaveLength(1)
  })

  it("shows a loop-count badge only when loops > 1", () => {
    const looped = makeNode({ id: "looped", loops: 950 })
    const single = makeNode({ id: "single", loops: 1 })
    const root = makeNode({ id: "root", children: [looped, single] })

    render(<PlanGraph root={root} />)

    const badges = screen.getAllByTestId("loop-badge")
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toContain("950")
  })

  it("clicking a collapsed-group placeholder expands its hidden subtree", () => {
    const root = buildLargePlan(520)

    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("collapsed-group-node")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("collapsed-group-node"))

    expect(screen.queryByTestId("collapsed-group-node")).not.toBeInTheDocument()
    // The previously-hidden filler chain is now rendered.
    const cards = screen.getAllByTestId("plan-node-card")
    expect(cards.length).toBeGreaterThan(520)
  })

  it("resets collapse state when a genuinely new plan (fresh parse result) is passed in", () => {
    const firstPlan = buildLargePlan(520)
    const { rerender } = render(<PlanGraph root={firstPlan} />)
    expect(screen.getByTestId("collapsed-group-node")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("collapsed-group-node"))
    expect(screen.queryByTestId("collapsed-group-node")).not.toBeInTheDocument()

    // A second, independently-built large plan (same shape/ids, different
    // object identity — exactly what a fresh parse of a new paste looks
    // like) must start collapsed again, not inherit the first plan's
    // manually-expanded state.
    const secondPlan = buildLargePlan(520)
    rerender(<PlanGraph root={secondPlan} />)
    expect(screen.getByTestId("collapsed-group-node")).toBeInTheDocument()
  })

  it("clicking a plan node card opens its detail panel", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    render(<PlanGraph root={root} />)

    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("plan-node-card"))
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Hash Join")
  })

  it("pressing Enter on a focused card opens the detail panel (keyboard access, not just mouse)", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Seq Scan" })
    render(<PlanGraph root={root} />)

    const card = screen.getByTestId("plan-node-card")
    card.focus()
    fireEvent.keyDown(card, { key: "Enter" })
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
  })

  it("pressing Escape closes the open detail panel", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)

    fireEvent.click(screen.getByTestId("plan-node-card"))
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
  })

  it("moves focus into the panel (the close button) when it opens", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)

    fireEvent.click(screen.getByTestId("plan-node-card"))
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close details" }))
  })

  it("restores focus to the triggering card when the panel closes", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)

    const card = screen.getByTestId("plan-node-card")
    card.focus()
    fireEvent.keyDown(card, { key: "Enter" })
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Close details" }))
    expect(document.activeElement).toBe(card)
  })

  it("restores focus to the triggering card on Escape too, not just the close button", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)

    const card = screen.getByTestId("plan-node-card")
    fireEvent.click(card)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(card)
  })

  it("clicking a different node swaps the panel content without needing to close first", () => {
    const a = makeNode({ id: "a", rawOperatorLabel: "Seq Scan" })
    const b = makeNode({ id: "b", rawOperatorLabel: "Index Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [a, b] })
    render(<PlanGraph root={root} />)

    const cards = screen.getAllByTestId("plan-node-card")
    const aCard = cards.find((c) => c.getAttribute("data-node-id") === "a")!
    const bCard = cards.find((c) => c.getAttribute("data-node-id") === "b")!

    fireEvent.click(aCard)
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Seq Scan")
    fireEvent.click(bCard)
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Index Scan")
  })
})
