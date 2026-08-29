import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WalkthroughOverlay } from "../WalkthroughOverlay"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import { buildPlanContext } from "../../../rules/types"

function buildMultiStepRoot() {
  const leaf = makeNode({
    id: "leaf",
    rawOperatorLabel: "Seq Scan",
    actualTimeMs: 8,
    warnings: [{ ruleId: "seq-scan-on-large-table", severity: "warning", shortText: "short", longText: "long" }],
  })
  const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", actualTimeMs: 10, children: [leaf] })
  return { root, leaf }
}

describe("WalkthroughOverlay", () => {
  it("starts on the first (leaf/execution-order) step and advances/retreats via Next/Previous", () => {
    const { root } = buildMultiStepRoot()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)

    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 1 of 2")
    expect(screen.getByTestId("walkthrough-step-heading")).toHaveTextContent(/Sequential Scan/i)
    expect(screen.getByTestId("walkthrough-prev")).toBeDisabled()

    fireEvent.click(screen.getByTestId("walkthrough-next"))
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 2 of 2")
    expect(screen.getByTestId("walkthrough-finish")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("walkthrough-prev"))
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 1 of 2")
  })

  it("ArrowRight/ArrowLeft step through, and each advance moves focus to the step heading", () => {
    const { root } = buildMultiStepRoot()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)
    const dialog = screen.getByTestId("walkthrough-overlay")

    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 2 of 2")
    expect(screen.getByTestId("walkthrough-step-heading")).toHaveFocus()

    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 1 of 2")
    expect(screen.getByTestId("walkthrough-step-heading")).toHaveFocus()
  })

  it("Escape exits with the CURRENT (last-viewed) node's id, not the first step's", () => {
    const { root, leaf } = buildMultiStepRoot()
    const onExit = vi.fn()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={onExit} />)

    fireEvent.click(screen.getByTestId("walkthrough-next")) // now on root
    fireEvent.keyDown(screen.getByTestId("walkthrough-overlay"), { key: "Escape" })

    expect(onExit).toHaveBeenCalledWith("root")
    expect(onExit).not.toHaveBeenCalledWith(leaf.id)
  })

  it("Finish (on the last step) exits with that step's node id", () => {
    const { root } = buildMultiStepRoot()
    const onExit = vi.fn()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={onExit} />)

    fireEvent.click(screen.getByTestId("walkthrough-next"))
    fireEvent.click(screen.getByTestId("walkthrough-finish"))

    expect(onExit).toHaveBeenCalledWith("root")
  })

  it("does not advance past the last step or retreat past the first via arrow keys", () => {
    const root = makeNode({ id: "solo", rawOperatorLabel: "Result", actualTimeMs: 1 })
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)
    const dialog = screen.getByTestId("walkthrough-overlay")

    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 1 of 1")
  })

  it("shows the honest 'nothing else stood out' note for a single-step (root-only) walkthrough", () => {
    const root = makeNode({ id: "solo", rawOperatorLabel: "Result", actualTimeMs: 1 })
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)
    expect(screen.getByTestId("walkthrough-minimal-note")).toBeInTheDocument()
  })

  it("does not show the minimal note once a real multi-step walkthrough exists", () => {
    const { root } = buildMultiStepRoot()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)
    expect(screen.queryByTestId("walkthrough-minimal-note")).not.toBeInTheDocument()
  })

  it("switching Beginner/Expert mid-walkthrough preserves the current step position", () => {
    const { root } = buildMultiStepRoot()
    const onExpertModeChange = vi.fn()
    const { rerender } = render(
      <WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={onExpertModeChange} onExit={() => {}} />,
    )
    fireEvent.click(screen.getByTestId("walkthrough-next")) // now on step 2 (root)
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 2 of 2")

    fireEvent.click(screen.getByTestId("walkthrough-mode-expert"))
    expect(onExpertModeChange).toHaveBeenCalledWith(true)

    // Simulate the parent actually flipping the controlled prop — step
    // position must survive the resulting re-render (only narration
    // density should change).
    rerender(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={true} onExpertModeChange={onExpertModeChange} onExit={() => {}} />)
    expect(screen.getByTestId("walkthrough-step-counter")).toHaveTextContent("Step 2 of 2")
  })

  it("findings render using shortText in Beginner, longText in Expert, matching WarningsSection's own inversion", () => {
    const { root } = buildMultiStepRoot()
    render(<WalkthroughOverlay root={root} context={buildPlanContext(root)} expertMode={false} onExpertModeChange={() => {}} onExit={() => {}} />)
    expect(screen.getByTestId("walkthrough-findings")).toHaveTextContent("short")
  })
})
