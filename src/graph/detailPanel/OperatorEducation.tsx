import { memo } from "react"
import { getGlossaryEntry, getGlossaryFallback } from "../glossary"

export interface OperatorEducationProps {
  operatorType: string
  rawOperatorLabel: string
  expertMode: boolean
}

/** Panel sections 2 ("What this does") and 5 ("In general") — both sourced
 * from the same glossary entry, but kept visually distinct per Story 6.2's
 * explicit acceptance criteria: one is general education, the other
 * (rendered separately by WarningsSection) is a specific finding, and the
 * two must never blur together. */
function OperatorEducationInner({ operatorType, rawOperatorLabel, expertMode }: OperatorEducationProps) {
  const entry = getGlossaryEntry(operatorType)

  if (!entry) {
    const fallback = getGlossaryFallback(rawOperatorLabel)
    return (
      <section className="detail-panel__section" data-testid="operator-education-fallback">
        <h3 className="detail-panel__section-heading">What this does</h3>
        <div className="detail-panel__education">{fallback.message}</div>
      </section>
    )
  }

  return (
    <>
      <section className="detail-panel__section" data-testid="operator-education-what">
        <h3 className="detail-panel__section-heading">What this does</h3>
        <div className="detail-panel__education">
          <p>{entry.shortDefinition}</p>
          {expertMode && <p>{entry.longDefinition}</p>}
        </div>
      </section>
      <section className="detail-panel__section" data-testid="operator-education-general">
        <h3 className="detail-panel__section-heading">In general</h3>
        <div className="detail-panel__education">
          <p>{entry.whenItsFine}</p>
          <p>{entry.whenToLookCloser}</p>
        </div>
      </section>
    </>
  )
}

// Story 16.1: memoized — the glossary lookup is already an O(1) Map read
// (see graph/glossary/index.ts), but this still skips it entirely on an
// unrelated re-render, and keeps the pattern consistent with this panel's
// other sections.
export const OperatorEducation = memo(OperatorEducationInner)
