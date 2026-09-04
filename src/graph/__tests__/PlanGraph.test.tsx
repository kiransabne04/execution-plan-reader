import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanGraph, type PlanGraphHandle } from "../PlanGraph"
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

// Big enough to trigger default-collapse (Episode 6) — the window this
// file's collapse tests need to exist in. Derived from the real constant
// rather than a magic number so it stays correct if it's ever retuned.
const COLLAPSE_FILLER_DEPTH = COLLAPSE_NODE_COUNT_THRESHOLD + 20

// Episode 26, Story 26.1 — canvas is now the ONLY rendering path, at every
// node count, so a plan node is never a real DOM element with its own
// testid/data-node-id the way React Flow's cards used to be. The
// accessible list (Story 15.2, now the universal keyboard/screen-reader
// path — see AccessiblePlanList.tsx's own comment) is this file's
// deterministic, testid-based way to drive PlanGraph's real selection/
// focus/collapse state end to end, without depending on canvas hit-testing
// pixel math — that's already covered in isolation by
// CanvasPlanGraph.test.tsx. Visual encoding (badges, icons, mismatch/
// severity/comparison rendering, the hover tooltip) is unit-tested at the
// layer that actually owns it now: canvasDraw.test.ts, buildGraphElements.
// test.ts, nodeTooltip.test.ts, operatorIcons.test.ts.
function openAccessibleList() {
  fireEvent.click(screen.getByTestId("accessible-list-toggle"))
}

function clickNode(nodeId: string) {
  const row = screen.getAllByTestId("accessible-plan-list-item").find((r) => r.getAttribute("data-node-id") === nodeId)!
  fireEvent.click(row)
}

describe("PlanGraph", () => {
  it("renders the canvas surface and the accessible-list toggle for a small plan, without crashing", () => {
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.getByTestId("accessible-list-toggle")).toBeInTheDocument()
  })

  it("renders a single-node plan without crashing", () => {
    const root = makeNode({ id: "solo", rawOperatorLabel: "Result" })
    render(<PlanGraph root={root} />)
    openAccessibleList()
    expect(screen.getAllByTestId("accessible-plan-list-item")).toHaveLength(1)
  })

  it("the accessible-list toggle switches the visible surface, and back", () => {
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph root={root} />)

    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.queryByTestId("accessible-plan-list")).not.toBeInTheDocument()

    openAccessibleList()
    expect(screen.queryByTestId("canvas-plan-graph-surface")).not.toBeInTheDocument()
    expect(screen.getByTestId("accessible-plan-list")).toBeInTheDocument()

    openAccessibleList()
    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
  })

  it("resets the accessible-list toggle back to the canvas view when a genuinely new plan arrives", () => {
    const firstPlan = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    const { rerender } = render(<PlanGraph root={firstPlan} />)
    openAccessibleList()
    expect(screen.getByTestId("accessible-plan-list")).toBeInTheDocument()

    const secondPlan = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    rerender(<PlanGraph root={secondPlan} />)
    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()
    expect(screen.queryByTestId("accessible-plan-list")).not.toBeInTheDocument()
  })

  it("clicking a collapsed-group row in the accessible list expands its hidden subtree", () => {
    const root = buildLargePlan(COLLAPSE_FILLER_DEPTH)
    render(<PlanGraph root={root} />)
    openAccessibleList()

    expect(screen.getByTestId("accessible-plan-list-collapsed")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("accessible-plan-list-collapsed"))

    expect(screen.queryByTestId("accessible-plan-list-collapsed")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("accessible-plan-list-item").length).toBeGreaterThan(COLLAPSE_FILLER_DEPTH)
  })

  it("resets collapse state when a genuinely new plan (fresh parse result) is passed in", () => {
    const firstPlan = buildLargePlan(COLLAPSE_FILLER_DEPTH)
    const { rerender } = render(<PlanGraph root={firstPlan} />)
    openAccessibleList()
    expect(screen.getByTestId("accessible-plan-list-collapsed")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("accessible-plan-list-collapsed"))
    expect(screen.queryByTestId("accessible-plan-list-collapsed")).not.toBeInTheDocument()

    // A second, independently-built large plan (same shape/ids, different
    // object identity — exactly what a fresh parse of a new paste looks
    // like) must start collapsed again, not inherit the first plan's
    // manually-expanded state. The reset also drops back to the canvas
    // view (asserted separately above) — re-open the list to check collapse.
    const secondPlan = buildLargePlan(COLLAPSE_FILLER_DEPTH)
    rerender(<PlanGraph root={secondPlan} />)
    openAccessibleList()
    expect(screen.getByTestId("accessible-plan-list-collapsed")).toBeInTheDocument()
  })

  it("clicking a node in the accessible list opens its detail panel", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
    clickNode("root")
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Hash Join")
  })

  it("Story 20.2: clicking a row focuses it with preventScroll — a bare .focus() would let the browser scroll the whole page to it", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus")
    clickNode("root")
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    focusSpy.mockRestore()
  })

  it("pressing Escape closes the open detail panel", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    clickNode("root")
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
  })

  it("moves focus into the panel (the close button) when it opens, without scrolling the page there", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus")
    clickNode("root")
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close details" }))
    // Story 20.2
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    focusSpy.mockRestore()
  })

  it("restores focus to the triggering row when the panel closes", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    const row = screen.getByTestId("accessible-plan-list-item")
    clickNode("root")
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus")
    fireEvent.click(screen.getByRole("button", { name: "Close details" }))
    expect(document.activeElement).toBe(row)
    // Story 20.2: the restore-on-close focus call also needs preventScroll,
    // same reasoning as the open-click case above.
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    focusSpy.mockRestore()
  })

  it("restores focus to the triggering row on Escape too, not just the close button", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    const row = screen.getByTestId("accessible-plan-list-item")
    clickNode("root")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(row)
  })

  it("clicking a different node swaps the panel content without needing to close first", () => {
    const a = makeNode({ id: "a", rawOperatorLabel: "Seq Scan" })
    const b = makeNode({ id: "b", rawOperatorLabel: "Index Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [a, b] })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    clickNode("a")
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Seq Scan")
    clickNode("b")
    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Index Scan")
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

    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    expect(screen.getByTestId("detail-panel-display-name")).toBeInTheDocument()
    // The ancestor standing between root and "deep-leaf" was expanded, not
    // just the panel opened on data reached some other way — confirmed via
    // the accessible list, which shares the exact same `collapsedIds` state.
    openAccessibleList()
    expect(screen.queryByTestId("accessible-plan-list-collapsed")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("accessible-plan-list-item").some((r) => r.getAttribute("data-node-id") === "deep-leaf")).toBe(true)
  })
})

describe("PlanGraph — Episode 22, Story 22.2 — node-anchored detail popup, default 'panel' variant unaffected", () => {
  it("default nodeDetailVariant ('panel') never renders a popup — opening a node via the accessible list still shows the plain panel", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    clickNode("root")
    const panel = screen.getByTestId("detail-panel")
    expect(panel).not.toHaveClass("detail-panel--popup")
    expect(panel.style.left).toBe("")
  })

  it("Escape and the close button both still close the panel", () => {
    const root = makeNode({ id: "root" })
    render(<PlanGraph root={root} />)
    openAccessibleList()

    clickNode("root")
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()

    clickNode("root")
    fireEvent.click(screen.getByRole("button", { name: "Close details" }))
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
  })

  it("a collapsed-group row click still just expands it — never opens a panel for the placeholder itself", () => {
    const root = buildLargePlan(COLLAPSE_FILLER_DEPTH)
    render(<PlanGraph root={root} />)
    openAccessibleList()

    expect(screen.getByTestId("accessible-plan-list-collapsed")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("accessible-plan-list-collapsed"))
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument()
  })
})

// Episode 18, Story 18.11 — jsdom's HTMLCanvasElement.getContext('2d')
// returns null (see CanvasPlanGraph.test.tsx's own comment on this), so
// the actual PIXEL output of exportPng() can only be verified in a real
// browser (e2e/png-export.spec.ts). What IS verifiable here is the
// imperative surface itself: the ref exposes exportPng, callable at any
// plan size, and a null 2D context degrades to a resolved `null` rather
// than a thrown error.
describe("PlanGraph — PNG export ref (Episode 18, Story 18.11)", () => {
  it("exposes an exportPng() handle via ref, for a small plan", async () => {
    const ref = createRef<PlanGraphHandle>()
    const root = makeNode({ id: "root", children: [makeNode({ id: "child" })] })
    render(<PlanGraph ref={ref} root={root} />)

    expect(ref.current?.exportPng).toBeTypeOf("function")
    await expect(ref.current!.exportPng()).resolves.toBeNull() // jsdom has no real 2D context
  })

  it("exposes the same handle for a large plan", async () => {
    const ref = createRef<PlanGraphHandle>()
    const root = buildLargePlan(520)
    render(<PlanGraph ref={ref} root={root} />)

    expect(ref.current?.exportPng).toBeTypeOf("function")
    await expect(ref.current!.exportPng()).resolves.toBeNull()
  })
})

// "Panel open is not blocked by graph rendering" (Story 16.1 edge case) is
// covered in detailPanelPerformance.test.tsx, not duplicated here.
