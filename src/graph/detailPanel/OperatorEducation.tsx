import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react"
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
      {/* Design tokens spec: "Phosphor, regular weight, fill only for the
          brand mark" — the mockup's own saved source uses plain
          `ph-graduation-cap` (regular), not a fill modifier. */}
      <GraduationCap aria-hidden="true" />
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
        {/* Design tokens spec: "Phosphor, regular weight, fill only for
            the brand mark" — the mockup's own saved source uses plain
            `ph-caret-right` (regular), not a bold modifier. */}
        <CaretRight aria-hidden="true" className={expanded ? "detail-panel__education-disclosure-caret--open" : undefined} />
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

/** User-directed: the WHOLE "What this operator does" body (not just the
 * long-definition paragraph) collapses behind a single "Read more"/"Show
 * less" toggle (styled as a plain text link, not a button-looking
 * button) — the needed-details bullets (`whenItsFine`/`whenToLookCloser`)
 * AND the full prose definition are both inside the same collapsible
 * region, so collapsing genuinely hides everything past the first ~6
 * lines' worth of content, not just the prose paragraph on its own.
 *
 * Height-based clamping (`max-height` + `overflow: hidden`), not CSS
 * `line-clamp`: `line-clamp` only truncates a single run of text
 * cleanly — it doesn't handle mixed content (icons, a `<ul>`, multiple
 * paragraphs) predictably, and this body is exactly that mix now that the
 * bullets sit above the definition. `COLLAPSED_MAX_HEIGHT_PX` is a
 * deliberate approximation of "about 6 lines" for this mixed content
 * (plain text alone would be ~6 × 19.5px line-height ≈ 117px; a little
 * extra accounts for the bullets' own icon alignment/gaps), not an exact
 * line count the way a single clamped paragraph could claim.
 *
 * `scrollHeight > clientHeight` on the clamped wrapper is the real signal
 * for "this content is genuinely being cut off" — never guessed from a
 * character/word count, which would be wrong across different container
 * widths/font sizes or content mixes. Measured once, at mount, while
 * still collapsed (the clamp is what creates the overflow to detect) —
 * toggling back to collapsed later doesn't need re-measuring, since the
 * toggle's own presence already proved overflow was real. Callers should
 * mount this with `key={node.id}` so switching to a different node's
 * content starts fresh (collapsed, re-measured) rather than carrying over
 * the previous node's expanded/canExpand state. */
const COLLAPSED_MAX_HEIGHT_PX = 132

function ExpandableEducationBody({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    setCanExpand(el.scrollHeight > el.clientHeight + 1)
    // Measure once, right after this fresh mount (see this component's
    // own doc comment on why `expanded` toggling later never needs a
    // second measurement) — the empty deps array is deliberate, not an
    // oversight; adding `expanded` here would re-measure a now-unclamped
    // (and therefore never-overflowing) element and silently erase a
    // correctly-detected `canExpand`.
  }, [])

  return (
    <>
      <div
        ref={wrapperRef}
        className={expanded ? "detail-panel__education-body" : "detail-panel__education-body detail-panel__education-body--clamped"}
        style={expanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }}
      >
        {children}
      </div>
      {canExpand && (
        <button
          type="button"
          className="detail-panel__education-readmore"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="operator-education-readmore"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </>
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
 * separate "In general") into ONE card — `whenItsFine`/`whenToLookCloser`
 * as a green-check / amber-warning bullet pair, then the long definition
 * (user-directed reorder: the actionable verdict first, the fuller prose
 * after it — see `ExpandableEducationBody`'s own doc comment), closed
 * with a small "General education — not a finding about your node."
 * caption (`operator-education-general` as a distinct testid is gone; the
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
          {/* User-directed reorder: the needed-details bullets (is this
              fine, or worth a second look) come FIRST — a beginner
              skimming wants that verdict before the fuller prose
              definition below it, not after. Both live inside the same
              collapsible body (see ExpandableEducationBody's own doc
              comment) so "Read more" reveals the whole rest of the
              section, not just the paragraph. */}
          <ExpandableEducationBody key={node.id}>
            <ul className="detail-panel__education-bullets">
              {/* Design tokens spec: "Phosphor, regular weight, fill only
                  for the brand mark" — the mockup's own saved source uses
                  plain `ph-check`/`ph-warning` (regular), not bold/fill. */}
              <li className="detail-panel__education-bullet detail-panel__education-bullet--fine">
                <Check aria-hidden="true" />
                <span>{entry.whenItsFine}</span>
              </li>
              <li className="detail-panel__education-bullet detail-panel__education-bullet--warning">
                <WarningIcon aria-hidden="true" />
                <span>{entry.whenToLookCloser}</span>
              </li>
            </ul>
            <p className="detail-panel__education-text">{entry.longDefinition}</p>
          </ExpandableEducationBody>
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
