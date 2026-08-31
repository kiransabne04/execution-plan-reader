import { memo } from "react"
import { GraduationCap } from "@phosphor-icons/react"
import { getGlossaryEntry, getGlossaryFallback } from "../glossary"

/** Design review (reference mock) — this section's own heading, distinct
 * from every other section's plain muted-gray one: an accent color plus a
 * leading icon, and "operator" spelled out ("What this operator does",
 * not "What this does") matching the mock's literal wording. Its own
 * small component (not just a className swap on the shared heading)
 * since it needs the icon slot the shared one doesn't. */
function EducationHeading({ children }: { children: string }) {
  return (
    <h3 className="detail-panel__section-heading detail-panel__education-heading">
      <GraduationCap weight="fill" aria-hidden="true" />
      {children}
    </h3>
  )
}

export interface OperatorEducationProps {
  operatorType: string
  rawOperatorLabel: string
  expertMode: boolean
}

/**
 * Panel sections 2 ("What this operator does") and 5 ("In general") — both sourced
 * from the same glossary entry, but kept visually distinct per Story 6.2's
 * explicit acceptance criteria: one is general education, the other
 * (rendered separately by WarningsSection) is a specific finding, and the
 * two must never blur together.
 *
 * Episode 18, Story 18.7: density flips by mode, per spec §5 `1f` —
 * **Beginner gets the LONG explanation** (`longDefinition` plus the full
 * "In general" guidance — a beginner needs the fuller teaching, not less
 * of it) and **Expert gets education collapsed to one line**
 * (`shortDefinition` alone, "In general" omitted entirely — an expert
 * already knows what this operator is and wants the space back for raw
 * data). This is a deliberate REVERSAL of Story 6.2's original field-level
 * intent (`shortDefinition`/`longDefinition` were originally documented as
 * "Beginner-mode default" / "Expert-mode default" respectively) — the
 * redesign spec is the newer, more deliberate authority here; see
 * `docs/BACKLOG-STATUS.md`'s Story 18.7 row for the full account, and
 * `glossary/types.ts` / the operator-glossary-content skill for the
 * updated field docs (that skill's own instruction: "if this skill and
 * those docs disagree, the docs win and this file should be updated").
 */
function OperatorEducationInner({ operatorType, rawOperatorLabel, expertMode }: OperatorEducationProps) {
  const entry = getGlossaryEntry(operatorType)

  if (!entry) {
    const fallback = getGlossaryFallback(rawOperatorLabel)
    return (
      <section className="detail-panel__section" data-testid="operator-education-fallback">
        <EducationHeading>What this operator does</EducationHeading>
        <div className="detail-panel__education">{fallback.message}</div>
      </section>
    )
  }

  if (expertMode) {
    return (
      <section className="detail-panel__section" data-testid="operator-education-what">
        <EducationHeading>What this operator does</EducationHeading>
        <div className="detail-panel__education">
          <p>{entry.shortDefinition}</p>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="detail-panel__section" data-testid="operator-education-what">
        <EducationHeading>What this operator does</EducationHeading>
        <div className="detail-panel__education">
          <p>{entry.longDefinition}</p>
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
