// Episode 22, Story 22.3 — PlanGraph.tsx's own integration with
// CanvasPlanGraph's `onSelectedNodeScreenAnchorChange` reporting.
// Deliberately a SEPARATE file from PlanGraph.test.tsx: this test mocks
// `CanvasPlanGraph` itself (a fake that lets a test fire the exact
// callbacks it wants, with a KNOWN anchor) to verify PlanGraph's own
// wiring — nodeDetailVariant, CanvasNodeDetailPopup's rendered position,
// the accessible-list edge case — precisely and without depending on real
// canvas hit-testing pixel math (already covered, for the anchor-
// computation itself, by CanvasPlanGraph.test.tsx and
// viewportTransform.test.ts). Mocking the whole module here would break
// PlanGraph.test.tsx's OWN canvas-mode tests (which need the real
// component) if it lived in that file instead.
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { CanvasPlanGraphProps } from "../canvas/CanvasPlanGraph"
import { PlanGraph } from "../PlanGraph"
import { makeNode } from "../../rules/__tests__/testHelpers"
import { COLLAPSE_NODE_COUNT_THRESHOLD } from "../collapse"

vi.mock("../canvas/CanvasPlanGraph", () => ({
  // A minimal stand-in exposing every real prop as a button, so a test can
  // fire whichever callback it needs with an exact, known value — the real
  // component's own click-to-hit-test/pan/zoom mechanics are out of scope
  // here on purpose (see the file-level comment above).
  CanvasPlanGraph: ({ onSelectNode, onSelectedNodeScreenAnchorChange }: CanvasPlanGraphProps) => (
    <div data-testid="fake-canvas-plan-graph">
      <button type="button" data-testid="fake-select-node" onClick={() => onSelectNode("expensive")}>
        select
      </button>
      <button
        type="button"
        data-testid="fake-report-anchor"
        onClick={() => onSelectedNodeScreenAnchorChange?.({ x: 100, y: 100, width: 160, height: 56 })}
      >
        report anchor
      </button>
      <button type="button" data-testid="fake-report-anchor-moved" onClick={() => onSelectedNodeScreenAnchorChange?.({ x: 900, y: 100, width: 160, height: 56 })}>
        report moved anchor
      </button>
      <button type="button" data-testid="fake-report-no-anchor" onClick={() => onSelectedNodeScreenAnchorChange?.(undefined)}>
        report no anchor
      </button>
    </div>
  ),
}))

// Mirrors PlanGraph.test.tsx's own helper — a plan big enough to trigger
// canvas-rendering mode (CANVAS_NODE_COUNT_THRESHOLD), which is what routes
// through the (mocked) CanvasPlanGraph branch at all.
function buildCanvasModePlan() {
  let filler = makeNode({ id: "deep-leaf", actualTimeMs: 0.001 })
  for (let i = 0; i < COLLAPSE_NODE_COUNT_THRESHOLD + 320; i++) {
    filler = makeNode({ id: `filler-${i}`, actualTimeMs: 0.001, children: [filler] })
  }
  const expensive = makeNode({ id: "expensive", actualTimeMs: 1_000_000 })
  return makeNode({ id: "root", actualTimeMs: 0, children: [expensive, filler] })
}

describe("PlanGraph — Episode 22, Story 22.3 — canvas-mode node-anchored popup wiring", () => {
  it("nodeDetailVariant='popup': selecting a node then receiving an anchor renders CanvasNodeDetailPopup's DetailPanel at that position", () => {
    const root = buildCanvasModePlan()
    render(<PlanGraph root={root} nodeDetailVariant="popup" />)

    fireEvent.click(screen.getByTestId("fake-select-node"))
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument() // no anchor reported yet — nothing to position it at

    fireEvent.click(screen.getByTestId("fake-report-anchor"))
    const panel = screen.getByTestId("detail-panel")
    expect(panel).toHaveClass("detail-panel--popup")
    expect(panel.style.left).toMatch(/^-?\d+(\.\d+)?px$/)
    expect(panel.style.top).toMatch(/^-?\d+(\.\d+)?px$/)
  })

  it("live-repositions as CanvasPlanGraph reports a new anchor (the pan/zoom-tracking mechanism) — never closes", () => {
    const root = buildCanvasModePlan()
    render(<PlanGraph root={root} nodeDetailVariant="popup" />)

    fireEvent.click(screen.getByTestId("fake-select-node"))
    fireEvent.click(screen.getByTestId("fake-report-anchor"))
    const firstLeft = screen.getByTestId("detail-panel").style.left

    fireEvent.click(screen.getByTestId("fake-report-anchor-moved"))
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument() // still open, not closed by the "pan"
    expect(screen.getByTestId("detail-panel").style.left).not.toBe(firstLeft)
  })

  it("default nodeDetailVariant ('panel') never mounts the popup — clicking still opens the plain edge-docked panel", () => {
    const root = buildCanvasModePlan()
    render(<PlanGraph root={root} />)

    fireEvent.click(screen.getByTestId("fake-select-node"))
    const panel = screen.getByTestId("detail-panel")
    expect(panel).not.toHaveClass("detail-panel--popup")
    expect(panel.style.left).toBe("")
  })

  it("CanvasPlanGraph is not even given the anchor-reporting callback outside popup mode", () => {
    const root = buildCanvasModePlan()
    const { rerender } = render(<PlanGraph root={root} />)
    // Nothing to assert on the DOM here directly (the mock doesn't render
    // its own prop values) — this is really documentation-by-test that
    // `nodeDetailVariant` defaulting to "panel" is a real behavioral
    // difference, covered concretely by the previous test; re-rendering in
    // popup mode and confirming the SAME click now opens a popup once an
    // anchor arrives is the meaningful assertion.
    fireEvent.click(screen.getByTestId("fake-select-node"))
    fireEvent.click(screen.getByTestId("fake-report-anchor"))
    expect(screen.getByTestId("detail-panel")).not.toHaveClass("detail-panel--popup")

    rerender(<PlanGraph root={root} nodeDetailVariant="popup" />)
    fireEvent.click(screen.getByTestId("fake-report-anchor"))
    expect(screen.getByTestId("detail-panel")).toHaveClass("detail-panel--popup")
  })

  // Found via testing this story against PlanReaderPage.tsx's real usage
  // (externalDetailPanel + onDetailPanelChange, exactly as the app shell
  // passes them): with the popup unavailable (no anchor — this is the
  // accessible list's own edge case) AND externalDetailPanel suppressing
  // this component's normal self-render, opening a node showed NOTHING at
  // all. PlanReaderPage's right rail is suppressed while maximized
  // (Story 22.1) trusting a popup to show instead; the accessible list
  // explicitly opts out of the popup (this episode's own edge-case table)
  // — so this component must fall back to rendering its own plain panel
  // directly in exactly this combination, `externalDetailPanel` or not.
  it("selecting a node via the accessible-list toggle, in popup mode, still shows a plain panel even with externalDetailPanel set — never a silent no-op", () => {
    const root = buildCanvasModePlan()
    render(<PlanGraph root={root} nodeDetailVariant="popup" externalDetailPanel onDetailPanelChange={() => {}} />)

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    fireEvent.click(screen.getAllByTestId("accessible-plan-list-item")[0])

    const panel = screen.getByTestId("detail-panel")
    expect(panel).not.toHaveClass("detail-panel--popup") // no anchor available here — a plain panel, not a mispositioned popup
  })
})
