import { memo } from "react"
import type { Engine, Warning } from "../../parsers/normalize"
import { FunnelCallout } from "./FunnelCallout"
import { getFunnelCallout } from "./funnelCallouts"

export interface WarningsSectionProps {
  warnings: Warning[]
  expertMode: boolean
  engine: Engine
}

/** Panel section 4 ("Why this might matter here") — the specific findings
 * for THIS node, reusing Warning.shortText/longText from the rule engine
 * rather than generating new copy. Omitted entirely (not padded with filler)
 * when nothing fired — see Story 6.2's explicit edge case for this.
 *
 * Also the one place Story 9.1's funnel callout renders: it only ever
 * appears alongside an actual fired warning on this specific node (never a
 * standalone banner), keyed off THIS node's own `engine` field (never a
 * plan-wide flag or rule ID) so a Postgres finding can never link to
 * QueryDoc or vice versa. */
function WarningsSectionInner({ warnings, expertMode, engine }: WarningsSectionProps) {
  if (warnings.length === 0) return null
  const callout = getFunnelCallout(engine)

  return (
    <section className="detail-panel__section" data-testid="warnings-section">
      <h3 className="detail-panel__section-heading">Why this might matter here</h3>
      {warnings.map((warning) => (
        <div
          key={warning.ruleId}
          className={
            warning.severity === "critical"
              ? "detail-panel__warning detail-panel__warning--critical"
              : "detail-panel__warning"
          }
          data-testid="warning-item"
        >
          {/* Story 18.7, spec §5 `1f`'s Expert bullet: "rule id shown" —
              the raw ruleId a power user might reference against docs or a
              future LLM-narrative-mode debug view, not shown in Beginner
              (it's an implementation detail, not something a first-time
              reader needs). */}
          {expertMode && (
            <span className="detail-panel__warning-rule-id" data-testid="warning-rule-id">
              {warning.ruleId}
            </span>
          )}
          {expertMode ? warning.longText : warning.shortText}
        </div>
      ))}
      {callout && <FunnelCallout callout={callout} />}
    </section>
  )
}

// Story 16.1: memoized so switching Beginner/Expert (which this section DOES
// read) still only re-renders when its own props actually change, and any
// other unrelated DetailPanel re-render skips this section entirely.
export const WarningsSection = memo(WarningsSectionInner)
