import { memo, useState } from "react"
import { CaretRight, Check, GraduationCap, Warning as WarningIcon } from "@phosphor-icons/react"
import type { PlanNode } from "../../parsers/normalize"
import { getGlossaryEntry, getGlossaryFallback } from "../glossary"
import { getPlannerReasoning } from "./plannerReasoning"

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
  node: PlanNode
  expertMode: boolean
}

/** Design review (downloaded "expert overlay details" PNG), spec §1f:
 * "Expert reorders, it does not just extend. Numbers first, education
 * last — collapsed to a single disclosure line at the bottom." A clickable
 * "▸ {displayName} — definition (collapsed)" row, expanding in place to the
 * same real `shortDefinition` text Expert mode already showed uncollapsed
 * before this — collapsed by default (matching the mock's own resting
 * state), never auto-expanded, since an expert who wants the reminder can
 * open it themselves. `displayName` is real glossary content (e.g.
 * "Sequential Scan") — no "a"/"an" article is prepended, sidestepping the
 * exact grammar-risk tradeoff this file's own doc comment already made for
 * the (unrelated) Beginner-mode heading. */
function ExpertEducationDisclosure({ displayName, shortDefinition }: { displayName: string; shortDefinition: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="detail-panel__section" data-testid="operator-education-what">
      <button
        type="button"
        className="detail-panel__education-disclosure"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <CaretRight weight="bold" aria-hidden="true" className={expanded ? "detail-panel__education-disclosure-caret--open" : undefined} />
        <span>
          {displayName} — definition{expanded ? "" : " (collapsed)"}
        </span>
      </button>
      {expanded && (
        <div className="detail-panel__education detail-panel__education--disclosed">
          <p>{shortDefinition}</p>
        </div>
      )}
    </section>
  )
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
 *
 * Design review (downloaded "beginner overlay details" PNG): the mockup
 * merges what used to be two boxes ("What this operator does" and a
 * separate "In general") into ONE card — long definition, then
 * `whenItsFine`/`whenToLookCloser` as a green-check / amber-warning
 * bullet pair instead of two plain paragraphs, closed with a small
 * "General education — not a finding about your node." caption
 * (`operator-education-general` as a distinct testid is gone; the
 * content lives inside `operator-education-what` now). Heading text
 * stays the existing generic "What this operator does" rather than the
 * mockup's own dynamic "WHAT A SEQUENTIAL SCAN IS" — building a
 * grammatically correct "a"/"an" per operator name from
 * `entry.displayName` is a real correctness risk across dozens of
 * glossary entries (an "AN HASH JOIN" typo is worse than a slightly
 * less punchy but always-correct heading) for a purely cosmetic gain.
 *
 * "Why the planner chose it here" isn't in that PNG at all — kept
 * anyway, as its own section right after, per this session's explicit
 * "any extra feature already in the app, keep it" instruction: real,
 * per-node-generated content (`plannerReasoning.ts`), not something the
 * PNG's absence should delete.
 */
function OperatorEducationInner({ node, expertMode }: OperatorEducationProps) {
  const entry = getGlossaryEntry(node.operatorType)

  if (!entry) {
    const fallback = getGlossaryFallback(node.rawOperatorLabel)
    return (
      <section className="detail-panel__section" data-testid="operator-education-fallback">
        <EducationHeading>What this operator does</EducationHeading>
        <div className="detail-panel__education">{fallback.message}</div>
      </section>
    )
  }

  if (expertMode) {
    return <ExpertEducationDisclosure displayName={entry.displayName} shortDefinition={entry.shortDefinition} />
  }

  const reasoning = getPlannerReasoning(node)

  return (
    <>
      <section className="detail-panel__section" data-testid="operator-education-what">
        <EducationHeading>What this operator does</EducationHeading>
        <div className="detail-panel__education">
          <p>{entry.longDefinition}</p>
          <ul className="detail-panel__education-bullets">
            <li className="detail-panel__education-bullet detail-panel__education-bullet--fine">
              <Check weight="bold" aria-hidden="true" />
              <span>{entry.whenItsFine}</span>
            </li>
            <li className="detail-panel__education-bullet detail-panel__education-bullet--warning">
              <WarningIcon weight="fill" aria-hidden="true" />
              <span>{entry.whenToLookCloser}</span>
            </li>
          </ul>
          <p className="detail-panel__education-caption">General education — not a finding about your node.</p>
        </div>
      </section>
      {reasoning && (
        <section className="detail-panel__section" data-testid="operator-education-why">
          <EducationHeading>Why the planner chose it here</EducationHeading>
          <div className="detail-panel__education">
            <p>{reasoning}</p>
          </div>
        </section>
      )}
    </>
  )
}

// Story 16.1: memoized — the glossary lookup is already an O(1) Map read
// (see graph/glossary/index.ts), but this still skips it entirely on an
// unrelated re-render, and keeps the pattern consistent with this panel's
// other sections.
export const OperatorEducation = memo(OperatorEducationInner)
