import { useEffect, useState } from "react"
import { dismissCallout, isCalloutDismissed, onCalloutDismissed } from "./calloutDismissal"
import type { FunnelCallout as FunnelCalloutData } from "./funnelCallouts"

export interface FunnelCalloutProps {
  callout: FunnelCalloutData
}

/**
 * Small, dismissible suggestion. The same per-product session dismissal is
 * shared with the plan-wide handoff after the findings summary.
 */
export function FunnelCallout({ callout }: FunnelCalloutProps) {
  const [dismissed, setDismissed] = useState(() => isCalloutDismissed(callout.product))
  useEffect(() => onCalloutDismissed(callout.product, () => setDismissed(true)), [callout.product])

  if (dismissed) return null

  return (
    <div className="detail-panel__funnel-callout" data-testid="funnel-callout">
      <span>{callout.text}</span>
      <a
        href={callout.url}
        target="_blank"
        rel="noopener noreferrer"
        className="detail-panel__funnel-callout-link"
      >
        {callout.cta}
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
