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
 * Design review (downloaded "expert overlay details" PNG), spec §1f: Expert
 * gets its own section heading ("Finding · rule provenance" — a mockup card
 * this session confirmed is filter-rows-discarded, not the ruleId the PNG
 * itself mislabeled it with) and its own headline treatment — mono
 * `{ruleId} · {severity}`, replacing Beginner's sentence-case "Warning ·
 * Bad row estimate" — plus, when the rule populated it
 * (Warning.provenance), a small mono table of the threshold tested, the
 * value that tripped it, and any additional conditions. The old separate
 * `warning-rule-id` span is gone in Expert mode specifically — the new
 * mono headline already contains the ruleId, so a second copy would just
 * duplicate it; the same `data-testid` moved onto the headline itself so
 * existing "rule id shown in Expert" coverage still holds.
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
      <h3 className="detail-panel__section-heading">{expertMode ? "Finding · rule provenance" : "Finding on this node"}</h3>
      {warnings.map((warning) => (
        <div
          key={warning.ruleId}
          className={`detail-panel__warning detail-panel__warning--${warning.severity}`}
          data-testid="warning-item"
        >
          {expertMode ? (
            <p
              className={`detail-panel__warning-heading-mono detail-panel__warning-heading--${warning.severity}`}
              data-testid="warning-rule-id"
            >
              {warning.ruleId} · {warning.severity}
            </p>
          ) : (
            // Design review (reference mock) — "Critical · Bad row
            // estimate": severity plus the specific rule family, bold and
            // severity-colored, ahead of the prose body below it. Reuses
            // the shared SEVERITY_LABEL (nodeSeverity.ts) rather than a
            // fourth independent copy of the same three strings.
            <p className={`detail-panel__warning-heading detail-panel__warning-heading--${warning.severity}`}>
              {SEVERITY_LABEL[warning.severity]} · {formatRuleFamilyLabel(warning.ruleId)}
            </p>
          )}
          {expertMode ? warning.longText : warning.shortText}
          {expertMode && warning.provenance && (
            <table
              className={`detail-panel__warning-provenance detail-panel__warning-provenance--${warning.severity}`}
              data-testid="warning-provenance"
            >
              <tbody>
                <tr>
                  <td>threshold</td>
                  <td>{warning.provenance.threshold}</td>
                </tr>
                <tr>
                  <td>computed</td>
                  <td className="detail-panel__warning-provenance-computed">{warning.provenance.computed}</td>
                </tr>
                {warning.provenance.additionalConditions?.map((condition) => (
                  <tr key={condition}>
                    <td>also required</td>
                    <td>{condition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
