import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanGraph, CANVAS_NODE_COUNT_THRESHOLD, type PlanGraphHandle } from "../PlanGraph"
import { COLLAPSE_NODE_COUNT_THRESHOLD } from "../collapse"
import { makeNode } from "../../rules/__tests__/testHelpers"

function buildLargePlan(fillerDepth: number) {
  let filler = makeNode({ id: "deep-leaf", actualTimeMs: 0.001 })
  for (let i = 0; i < fillerDepth; i++) {
    filler = makeNode({ id: `filler-${i}`, actualTimeMs: 0.001, children: [filler] })
  }
  const expensive = makeNode({ id: "expensive", actualTimeMs: 1_000_000 })
  return makeNode({ id: "root", actualTimeMs: 0, children: [expensive, filler] })
}

// Big enough to trigger default-collapse (Episode 6), but small enough to
// stay in DOM/SVG rendering mode (below Episode 15's canvas threshold) —
// the window this file's DOM-specific collapse tests need to exist in.
// Derived from the real constants rather than a magic number so it stays
// correct if either threshold is retuned later.
const DOM_MODE_COLLAPSE_FILLER_DEPTH = COLLAPSE_NODE_COUNT_THRESHOLD + 20

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

  it("Episode 18, Story 18.8 — matchedNodeIds dims non-matching cards via opacity, never unmounts them", () => {
    const leaf1 = makeNode({ id: "leaf1", rawOperatorLabel: "Seq Scan", actualRows: 100 })
    const leaf2 = makeNode({ id: "leaf2", rawOperatorLabel: "Seq Scan", actualRows: 200 })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", actualRows: 300, children: [leaf1, leaf2] })

    render(<PlanGraph root={root} matchedNodeIds={new Set(["root"])} />)

    const cards = screen.getAllByTestId("plan-node-card")
    expect(cards).toHaveLength(3) // still every node, unmounted count unchanged

    const rootCard = cards.find((c) => c.getAttribute("data-node-id") === "root")!
    const leafCard = cards.find((c) => c.getAttribute("data-node-id") === "leaf1")!
    expect(rootCard.parentElement).not.toHaveAttribute("data-dimmed")
    expect(leafCard.parentElement).toHaveAttribute("data-dimmed", "true")
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

  // Design mockup review (post-Episode-18): spec §3's badge table names
  // "mismatch factor" explicitly (mockup renders "est. mismatch 95×").
  it("the mismatch badge includes the actual/estimated ratio when computable", () => {
    const node = makeNode({
      id: "a",
      estimatedRows: 12_400,
      actualRows: 1_182_904,
      warnings: [{ ruleId: "bad-row-estimate", severity: "warning", shortText: "x", longText: "y" }],
    })
    const root = makeNode({ id: "root", children: [node] })

    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("mismatch-badge")).toHaveTextContent("est. mismatch 95×")
  })

  // Design mockup review (post-Episode-18): spec §3's badge table names
  // "spill size" as its own badge.
  it("shows a spill badge with a compact byte size on a node that spilled to disk", () => {
    const node = makeNode({ id: "a", spill: { occurred: true, bytesLocal: 104_857_600 } })
    const root = makeNode({ id: "root", children: [node] })

    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("spill-badge")).toHaveTextContent("spilled 100 MB")
  })

  it("shows no spill badge on a node that didn't spill", () => {
    const node = makeNode({ id: "a" })
    const root = makeNode({ id: "root", children: [node] })
    render(<PlanGraph root={root} />)
    expect(screen.queryByTestId("spill-badge")).not.toBeInTheDocument()
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

  it("clicking a collapsed-group placeholder expands its hidden subtree (DOM/SVG mode)", () => {
    expect(DOM_MODE_COLLAPSE_FILLER_DEPTH + 2).toBeLessThan(CANVAS_NODE_COUNT_THRESHOLD) // sanity: still DOM mode
    const root = buildLargePlan(DOM_MODE_COLLAPSE_FILLER_DEPTH)

    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("collapsed-group-node")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("collapsed-group-node"))

    expect(screen.queryByTestId("collapsed-group-node")).not.toBeInTheDocument()
    // The previously-hidden filler chain is now rendered.
    const cards = screen.getAllByTestId("plan-node-card")
    expect(cards.length).toBeGreaterThan(DOM_MODE_COLLAPSE_FILLER_DEPTH)
  })

  it("resets collapse state when a genuinely new plan (fresh parse result) is passed in", () => {
    const firstPlan = buildLargePlan(DOM_MODE_COLLAPSE_FILLER_DEPTH)
    const { rerender } = render(<PlanGraph root={firstPlan} />)
    expect(screen.getByTestId("collapsed-group-node")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("collapsed-group-node"))
    expect(screen.queryByTestId("collapsed-group-node")).not.toBeInTheDocument()

    // A second, independently-built large plan (same shape/ids, different
    // object identity — exactly what a fresh parse of a new paste looks
    // like) must start collapsed again, not inherit the first plan's
    // manually-expanded state.
    const secondPlan = buildLargePlan(DOM_MODE_COLLAPSE_FILLER_DEPTH)
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

  it("renders a hover tooltip only on nodes that have a predicate/seek/join condition", () => {
    const withSeek = makeNode({
      id: "seek",
      rawOperatorLabel: "Index Seek",
      predicate: { indexCondition: "[CustomerId]=(42)" },
    })
    const withoutOne = makeNode({ id: "plain", rawOperatorLabel: "Sort" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [withSeek, withoutOne] })
    render(<PlanGraph root={root} />)

    const cards = screen.getAllByTestId("plan-node-card")
    const seekCard = cards.find((c) => c.getAttribute("data-node-id") === "seek")!.parentElement!
    const plainCard = cards.find((c) => c.getAttribute("data-node-id") === "plain")!.parentElement!

    expect(seekCard.querySelector('[data-testid="plan-node-tooltip"]')).toHaveTextContent("Seek: [CustomerId]=(42)")
    expect(plainCard.querySelector('[data-testid="plan-node-tooltip"]')).toBeNull()
  })

  it("focusNodeId opens the detail panel for that node without a click", () => {
    const a = makeNode({ id: "a", rawOperatorLabel: "Seq Scan" })
    const b = makeNode({ id: "b", rawOperatorLabel: "Index Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [a, b] })

    render(<PlanGraph root={root} focusNodeId="b" />)

    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Index Scan")
  })

  it("focusNodeId calls onFocusHandled once it's applied", () => {
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    const onFocusHandled = vi.fn()

    render(<PlanGraph root={root} focusNodeId="child" onFocusHandled={onFocusHandled} />)

    expect(onFocusHandled).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("detail-panel-display-name")).toBeInTheDocument()
  })

  it("focusNodeId reveals a node hidden inside a collapsed subtree, not just opens its panel data", () => {
    const root = buildLargePlan(520)

    render(<PlanGraph root={root} focusNodeId="deep-leaf" />)

    expect(screen.queryByTestId("collapsed-group-node")).not.toBeInTheDocument()
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
  })
})

// Episode 15 — above CANVAS_NODE_COUNT_THRESHOLD, PlanGraph switches from
// the DOM/SVG <ReactFlow> tree to the canvas rendering path, with the
// accessible list as its required companion (Story 15.2). Pointer-driven
// interaction on the canvas itself is covered directly in
// CanvasPlanGraph.test.tsx (needs a mocked getBoundingClientRect that
// doesn't belong in every test here); these tests cover PlanGraph's own
// mode-switch wiring and the accessible list's real end-to-end path.
describe("PlanGraph — canvas mode (Episode 15)", () => {
  it("renders the canvas surface, not React Flow's DOM cards, above the canvas threshold", () => {
    const root = buildLargePlan(520)
    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.queryByTestId("plan-node-card")).not.toBeInTheDocument()
  })

  it("renders the DOM/SVG path, not canvas, below the threshold", () => {
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph root={root} />)

    expect(screen.queryByTestId("canvas-plan-graph-surface")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("plan-node-card").length).toBeGreaterThan(0)
  })

  it("the accessible-list toggle is always present in canvas mode and switches the visible surface", () => {
    const root = buildLargePlan(520)
    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.queryByTestId("accessible-plan-list")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))

    expect(screen.queryByTestId("canvas-plan-graph-surface")).not.toBeInTheDocument()
    expect(screen.getByTestId("accessible-plan-list")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
  })

  it("clicking a row in the accessible list opens the same real detail panel DOM/SVG mode uses", () => {
    const root = buildLargePlan(CANVAS_NODE_COUNT_THRESHOLD + 5)
    render(<PlanGraph root={root} />)

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    fireEvent.click(screen.getAllByTestId("accessible-plan-list-item")[0]) // "root" itself, always the first row

    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
  })

  it("expanding a collapsed group through the accessible list is reflected consistently (shared collapse state, not a second view)", () => {
    const root = buildLargePlan(520)
    render(<PlanGraph root={root} />)

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    expect(screen.getByTestId("accessible-plan-list-collapsed")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("accessible-plan-list-collapsed"))
    expect(screen.queryByTestId("accessible-plan-list-collapsed")).not.toBeInTheDocument()

    // Switching back to the canvas view after expanding via the list must
    // not silently re-collapse it — same collapsedIds state, not two
    // independently-drifting views.
    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    expect(screen.queryByTestId("accessible-plan-list-collapsed")).not.toBeInTheDocument()
  })

  it("resets the accessible-list toggle back to the canvas view when a genuinely new plan arrives", () => {
    const firstPlan = buildLargePlan(520)
    const { rerender } = render(<PlanGraph root={firstPlan} />)
    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    expect(screen.getByTestId("accessible-plan-list")).toBeInTheDocument()

    const secondPlan = buildLargePlan(520)
    rerender(<PlanGraph root={secondPlan} />)
    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.queryByTestId("accessible-plan-list")).not.toBeInTheDocument()
  })

  // Episode 18, Story 18.10, spec §5 `1i`.
  it("shows a banner explaining the DOM->canvas switch, driven by the same allNodes.length basis as the mode switch itself, never below the threshold", () => {
    const large = buildLargePlan(520)
    render(<PlanGraph root={large} />)
    expect(screen.getByTestId("canvas-mode-banner")).toBeInTheDocument()

    const small = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph root={small} />)
    expect(screen.queryAllByTestId("canvas-mode-banner")).toHaveLength(1) // only the large-plan render above, not this one
  })

  it("the banner's own toggle (accessible-list) stays reachable alongside it — the banner is additive, not a replacement of the always-present toggle", () => {
    const root = buildLargePlan(520)
    render(<PlanGraph root={root} />)
    expect(screen.getByTestId("canvas-mode-banner")).toBeInTheDocument()
    expect(screen.getByTestId("accessible-list-toggle")).toBeInTheDocument()
  })
})

// Episode 18, Story 18.11 — jsdom's HTMLCanvasElement.getContext('2d')
// returns null (see CanvasPlanGraph.test.tsx's own comment on this), so
// the actual PIXEL output of exportPng() can only be verified in a real
// browser (e2e/png-export.spec.ts). What IS verifiable here is the
// imperative surface itself: the ref exposes exportPng, it's callable in
// both DOM/SVG and canvas mode, and a null 2D context degrades to a
// resolved `null` rather than a thrown error.
describe("PlanGraph — PNG export ref (Episode 18, Story 18.11)", () => {
  it("exposes an exportPng() handle via ref, in DOM/SVG mode", async () => {
    const ref = createRef<PlanGraphHandle>()
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph ref={ref} root={root} />)

    expect(ref.current?.exportPng).toBeTypeOf("function")
    await expect(ref.current!.exportPng()).resolves.toBeNull() // jsdom has no real 2D context
  })

  it("exposes the same handle in canvas mode — the export path doesn't care which live rendering mode produced the plan", async () => {
    const ref = createRef<PlanGraphHandle>()
    const root = buildLargePlan(520)
    render(<PlanGraph ref={ref} root={root} />)

    expect(ref.current?.exportPng).toBeTypeOf("function")
    await expect(ref.current!.exportPng()).resolves.toBeNull()
  })
})
