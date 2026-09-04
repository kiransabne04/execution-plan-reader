// Episode 26, Story 26.3 — drag-resize height. jsdom has no real layout, so
// `getBoundingClientRect()` is stubbed with fixed values (matching
// CanvasPlanGraph.test.tsx's own established pattern for exactly this
// limitation) to make the drag math exercisable and deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { FindingsDrawer, type FindingsSummaryCounts } from "../FindingsDrawer"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import type { PlanNode, Warning } from "../../../parsers/normalize"
import type { FindingsSource } from "../../../rules/findings"

function withWarnings(node: PlanNode, warnings: Warning[]): PlanNode {
  node.warnings = warnings
  return node
}

function warning(overrides: Partial<Warning>): Warning {
  return { ruleId: "test-rule", severity: "warning", shortText: "Something happened.", longText: "...", ...overrides }
}

function sources(root: PlanNode): FindingsSource[] {
  return [{ statementIndex: 0, statementLabel: "Statement 1", root }]
}

const SUMMARY: FindingsSummaryCounts = { total: 1, critical: 0, warning: 1, info: 0 }

// Body height 400px; the drawer's own parent (the "container" the 80%-max
// clamp measures against) 900px — distinct values so a test can tell which
// one a given assertion is actually driven by.
const BODY_HEIGHT = 400
const CONTAINER_HEIGHT = 900

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.className.toString().includes("findings-drawer__body") ? BODY_HEIGHT : CONTAINER_HEIGHT
    return { width: 800, height, top: 0, left: 0, right: 800, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderOpenDrawer(root: PlanNode) {
  return render(
    <FindingsDrawer
      sources={sources(root)}
      activeStatementIndex={0}
      onSelectNode={vi.fn()}
      summary={SUMMARY}
      isOpen
      onOpenChange={vi.fn()}
      detailPanelOpen={false}
    />,
  )
}

describe("FindingsDrawer — drag-resize height (Story 26.3)", () => {
  it("renders the resize handle only while open", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    const { rerender } = render(
      <FindingsDrawer sources={sources(root)} activeStatementIndex={0} onSelectNode={vi.fn()} summary={SUMMARY} isOpen={false} onOpenChange={vi.fn()} detailPanelOpen={false} />,
    )
    expect(screen.queryByTestId("findings-drawer-resize-handle")).not.toBeInTheDocument()

    rerender(
      <FindingsDrawer sources={sources(root)} activeStatementIndex={0} onSelectNode={vi.fn()} summary={SUMMARY} isOpen onOpenChange={vi.fn()} detailPanelOpen={false} />,
    )
    expect(screen.getByTestId("findings-drawer-resize-handle")).toBeInTheDocument()
  })

  it("dragging the handle up grows the body's max-height by the drag distance", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400 }) // moved up 100px

    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${BODY_HEIGHT + 100}px` })
  })

  it("dragging the handle down shrinks it", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 600 }) // moved down 100px

    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${BODY_HEIGHT - 100}px` })
  })

  it("clamps to a minimum floor — dragging far past zero never collapses the panel to nothing", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 5000 }) // absurdly far down

    const height = Number((screen.getByTestId("findings-drawer-body") as HTMLElement).style.maxHeight.replace("px", ""))
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThan(BODY_HEIGHT)
  })

  it("clamps to 80% of the drawer's own container height — dragging far past the top never swallows the whole canvas", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -5000 }) // absurdly far up

    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${CONTAINER_HEIGHT * 0.8}px` })
  })

  it("the arrow keys resize too, for a keyboard-only user", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.keyDown(handle, { key: "ArrowUp" })
    const body = screen.getByTestId("findings-drawer-body") as HTMLElement
    const heightAfterUp = Number(body.style.maxHeight.replace("px", ""))
    expect(heightAfterUp).toBeGreaterThan(0)

    fireEvent.keyDown(handle, { key: "ArrowDown" })
    fireEvent.keyDown(handle, { key: "ArrowDown" })
    const heightAfterDown = Number(body.style.maxHeight.replace("px", ""))
    expect(heightAfterDown).toBeLessThan(heightAfterUp)
  })

  it("a custom height survives a re-render of the SAME plan (e.g. switching statements)", () => {
    const root = withWarnings(makeNode({ id: "n" }), [warning({})])
    const { rerender } = renderOpenDrawer(root)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 400 })
    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${BODY_HEIGHT + 100}px` })

    // Same root object identity, different activeStatementIndex — simulates
    // switching tabs on the same batch, not a fresh analyze.
    rerender(
      <FindingsDrawer sources={sources(root)} activeStatementIndex={1} onSelectNode={vi.fn()} summary={SUMMARY} isOpen onOpenChange={vi.fn()} detailPanelOpen={false} />,
    )
    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${BODY_HEIGHT + 100}px` })
  })

  it("resets to the default height when a genuinely new plan (different root identity) is passed in", () => {
    const firstRoot = withWarnings(makeNode({ id: "first" }), [warning({})])
    const { rerender } = renderOpenDrawer(firstRoot)
    const handle = screen.getByTestId("findings-drawer-resize-handle")

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 }) // +200px
    expect(screen.getByTestId("findings-drawer-body")).toHaveStyle({ maxHeight: `${BODY_HEIGHT + 200}px` })

    const secondRoot = withWarnings(makeNode({ id: "second" }), [warning({})])
    rerender(
      <FindingsDrawer sources={sources(secondRoot)} activeStatementIndex={0} onSelectNode={vi.fn()} summary={SUMMARY} isOpen onOpenChange={vi.fn()} detailPanelOpen={false} />,
    )
    // No inline style at all — back to the original, unmodified
    // `min(38vh, 420px)` CSS default (planReaderPage.css), not a
    // hardcoded pixel value re-applied here.
    expect((screen.getByTestId("findings-drawer-body") as HTMLElement).style.maxHeight).toBe("")
  })
})
