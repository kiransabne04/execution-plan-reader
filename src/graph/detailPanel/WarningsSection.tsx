import { memo } from "react"
import type { Engine, Warning } from "../../parsers/normalize"
import { SEVERITY_LABEL } from "../nodeSeverity"
import { ruleFamily } from "../../rules/summarize"
import { FunnelCallout } from "./FunnelCallout"
import { getFunnelCallout } from "./funnelCallouts"

/** Design review (reference mock) — "bad-row-estimate" -> "Bad row
 * estimate": the rule FAMILY (not `findingCategory.ts`'s broader grouping,
 * e.g. "Estimate issues" — the mock's own wording names the specific rule,
 * not its category) with dashes turned to spaces and sentence-cased. */
function formatRuleFamilyLabel(ruleId: string): string {
  const words = ruleFamily(ruleId).split("-")
  return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ")
}

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
      {/* Design review (reference mock) — "Finding on this node" (mock's
          own literal wording, singular regardless of count — same
          "don't over-engineer a heading" spirit the rest of this panel's
          fixed section headings already follow). */}
      <h3 className="detail-panel__section-heading">Finding on this node</h3>
      {warnings.map((warning) => (
        <div
          key={warning.ruleId}
          className={`detail-panel__warning detail-panel__warning--${warning.severity}`}
          data-testid="warning-item"
        >
          {/* Design review (reference mock) — "Critical · Bad row
              estimate": severity plus the specific rule family, bold and
              severity-colored, ahead of the prose body below it. Reuses
              the shared SEVERITY_LABEL (nodeSeverity.ts) rather than a
              fourth independent copy of the same three strings. */}
          <p className={`detail-panel__warning-heading detail-panel__warning-heading--${warning.severity}`}>
            {SEVERITY_LABEL[warning.severity]} · {formatRuleFamilyLabel(warning.ruleId)}
          </p>
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
