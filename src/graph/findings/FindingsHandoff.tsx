import { useEffect, useState } from "react"
import type { Engine } from "../../parsers/normalize"
import { dismissCallout, isCalloutDismissed, onCalloutDismissed } from "../detailPanel/calloutDismissal"
import { getFunnelCallout, getSummaryHandoffText } from "../detailPanel/funnelCallouts"

export function FindingsHandoff({ engine, hasFindings }: { engine: Engine; hasFindings: boolean }) {
  const callout = getFunnelCallout(engine)
  const [dismissed, setDismissed] = useState(() => isCalloutDismissed(callout.product))
  useEffect(() => onCalloutDismissed(callout.product, () => setDismissed(true)), [callout.product])

  if (dismissed) return null

  return (
    <div className={`findings-handoff findings-handoff--${engine}`} data-testid="findings-handoff">
      <p>{getSummaryHandoffText(engine, hasFindings)}</p>
      <a href={callout.url} target="_blank" rel="noopener noreferrer">
        {callout.cta}
      </a>
      <button
        type="button"
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
