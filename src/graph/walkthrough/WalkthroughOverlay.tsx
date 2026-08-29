// Episode 18, Story 18.9 — the walkthrough's full-screen UI. Pure
// presentation over walkthroughSteps.ts/walkthroughNarration.ts's pure
// logic, matching this codebase's established split (buildGraphElements.ts,
// searchNodes.ts) between testable logic and its React wrapper.

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { computeWalkthroughSteps } from "./walkthroughSteps"
import { buildStepNarration } from "./walkthroughNarration"
import "./walkthroughOverlay.css"

export interface WalkthroughOverlayProps {
  root: PlanNode
  context: PlanContext
  /** Story 18.7's shared density split, not a third one — spec §5 `1g`:
   * "Beginner mode by default; entering from Expert keeps the toggle."
   * Controlled from the same page-level state Story 18.3 lifted, so
   * switching mode here also affects the detail panel once the
   * walkthrough exits, and vice versa. */
  expertMode: boolean
  onExpertModeChange: (expertMode: boolean) => void
  /** Fires once, with the LAST-VIEWED node's id, when the walkthrough
   * closes (Escape or the Close/Finish button) — the caller feeds this
   * straight into the existing `focusNodeId` mechanism (Story 13.1/18.8's
   * same plumbing) so the shell reopens with that node's detail panel
   * already showing. */
  onExit: (lastViewedNodeId: string) => void
}

export function WalkthroughOverlay({ root, context, expertMode, onExpertModeChange, onExit }: WalkthroughOverlayProps) {
  const { steps, isMinimal } = computeWalkthroughSteps(root, context)
  const [stepIndex, setStepIndex] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Focus the step heading on every advance — an explicit, testable
  // requirement (this story's own AC), not assumed to fall out of DOM
  // order. Also fires on mount, landing focus here as soon as the
  // walkthrough opens.
  useEffect(() => {
    headingRef.current?.focus()
  }, [stepIndex])

  const currentNode = steps[stepIndex]
  const narration = buildStepNarration(currentNode, context, expertMode)
  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1

  const exit = () => onExit(currentNode.id)
  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  const goPrev = () => setStepIndex((i) => Math.max(i - 1, 0))

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      exit()
    } else if (event.key === "ArrowRight" && !isLast) {
      event.preventDefault()
      goNext()
    } else if (event.key === "ArrowLeft" && !isFirst) {
      event.preventDefault()
      goPrev()
    }
  }

  return (
    // Spec §5 `1g`: "graph dimmed behind it (not hidden)" — a translucent
    // backdrop over the still-mounted, still-visible graph, not a second
    // rendering of it and not `display: none` on it.
    <div className="walkthrough-overlay" data-testid="walkthrough-overlay" role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
      <div className="walkthrough-overlay__card">
        <header className="walkthrough-overlay__header">
          <span className="walkthrough-overlay__step-counter" data-testid="walkthrough-step-counter">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <div className="walkthrough-overlay__mode-toggle" role="group" aria-label="Detail level">
            <button
              type="button"
              aria-pressed={!expertMode}
              data-testid="walkthrough-mode-beginner"
              onClick={() => onExpertModeChange(false)}
            >
              Beginner
            </button>
            <button
              type="button"
              aria-pressed={expertMode}
              data-testid="walkthrough-mode-expert"
              onClick={() => onExpertModeChange(true)}
            >
              Expert
            </button>
          </div>
          <button type="button" className="walkthrough-overlay__close" data-testid="walkthrough-close" aria-label="Close walkthrough" onClick={exit}>
            ×
          </button>
        </header>

        <h2 className="walkthrough-overlay__heading" tabIndex={-1} ref={headingRef} data-testid="walkthrough-step-heading">
          {narration.displayName}
        </h2>

        {isMinimal && (
          <p className="walkthrough-overlay__minimal-note" data-testid="walkthrough-minimal-note">
            Nothing else in this plan stood out — no node carries a warning or uses 10% or more of the total time/cost. This is
            a healthy sign, not a limitation of the walkthrough.
          </p>
        )}

        <p className="walkthrough-overlay__explanation">{narration.explanation}</p>

        {narration.contributionPercent !== undefined && (
          <p className="walkthrough-overlay__contribution" data-testid="walkthrough-contribution">
            {narration.contributionPercent.toFixed(1)}% of the plan's total cost/time.
          </p>
        )}

        {narration.findings.length > 0 && (
          <ul className="walkthrough-overlay__findings" data-testid="walkthrough-findings">
            {narration.findings.map((finding, index) => (
              <li key={index}>{finding}</li>
            ))}
          </ul>
        )}

        <footer className="walkthrough-overlay__footer">
          <button type="button" data-testid="walkthrough-prev" disabled={isFirst} onClick={goPrev}>
            ← Previous
          </button>
          {isLast ? (
            <button type="button" data-testid="walkthrough-finish" onClick={exit}>
              Finish
            </button>
          ) : (
            <button type="button" data-testid="walkthrough-next" onClick={goNext}>
              Next →
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
