import { useState } from "react"
import { dismissCallout, isCalloutDismissed } from "./calloutDismissal"
import type { FunnelCallout as FunnelCalloutData } from "./funnelCallouts"

export interface FunnelCalloutProps {
  callout: FunnelCalloutData
}

/**
 * Story 9.1 — a small, dismissible, non-pushy nudge. Only ever rendered by
 * WarningsSection alongside an actual fired warning on the currently-open
 * node — never a standalone/always-visible banner. Dismissal is session-
 * scoped and per-product (see calloutDismissal.ts): closing it hides every
 * callout for that product for the rest of the session, not just this node.
 */
export function FunnelCallout({ callout }: FunnelCalloutProps) {
  const [dismissed, setDismissed] = useState(() => isCalloutDismissed(callout.product))

  if (dismissed) return null

  return (
    <div className="detail-panel__funnel-callout" data-testid="funnel-callout">
      <a
        href={callout.url}
        target="_blank"
        rel="noopener noreferrer"
        className="detail-panel__funnel-callout-link"
      >
        {callout.text}
      </a>
      <button
        type="button"
        className="detail-panel__funnel-callout-dismiss"
        aria-label="Dismiss this suggestion"
        onClick={() => {
          dismissCallout(callout.product)
          setDismissed(true)
        }}
      >
        ×
      </button>
    </div>
  )
}
