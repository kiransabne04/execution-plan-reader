import type { Warning } from "../../parsers/normalize"

export interface WarningsSectionProps {
  warnings: Warning[]
  expertMode: boolean
}

/** Panel section 4 ("Why this might matter here") — the specific findings
 * for THIS node, reusing Warning.shortText/longText from the rule engine
 * rather than generating new copy. Omitted entirely (not padded with filler)
 * when nothing fired — see Story 6.2's explicit edge case for this. */
export function WarningsSection({ warnings, expertMode }: WarningsSectionProps) {
  if (warnings.length === 0) return null

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
          {expertMode ? warning.longText : warning.shortText}
        </div>
      ))}
    </section>
  )
}
