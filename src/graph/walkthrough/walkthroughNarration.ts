// Episode 18, Story 18.9 — narration built from exactly the same data
// DetailPanel's OperatorEducation/WarningsSection already read. Per the
// graph-visualization skill's own explicit rule for this feature: "Reuses
// Warning.shortText/longText from the rule engine — this must never become
// a second content-authoring surface with its own copy." No new prose is
// authored here; this only selects which existing field to show, exactly
// mirroring OperatorEducation.tsx/WarningsSection.tsx's own mode-dependent
// field selection (Story 18.7) so the two surfaces can never drift apart.

import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { getGlossaryEntry, getGlossaryFallback } from "../glossary"
import { computeContributionPercent } from "../detailPanel/computeContributionPercent"

export interface WalkthroughStepNarration {
  /** Always `node.rawOperatorLabel` — the SAME label the graph card,
   * detail panel, and findings list all show for this exact node
   * (Story 20.6 fix). The glossary's own `entry.displayName` is a
   * generic, engine-agnostic name ("Append") used nowhere else in this
   * app — showing it here instead of the raw label ("Concatenation")
   * made the walkthrough the one surface where the SAME node appeared
   * to have two different names, breaking the mental link between what
   * the walkthrough narrates and what's visible in the graph behind it. */
  displayName: string
  /** Same field OperatorEducation.tsx's "What this does" section reads for
   * this exact mode — `entry.longDefinition` in Beginner, `entry.shortDefinition`
   * in Expert (Story 18.7's reversal), or the glossary fallback message when
   * this operatorType has no entry at all. */
  explanation: string
  /** Same field WarningsSection.tsx reads per mode — `shortText` in
   * Beginner, `longText` in Expert — one entry per warning on this node,
   * in the node's own warning order. Empty when the node has none (the
   * root is always a step even with zero warnings, per the walkthrough's
   * own inclusion rule). */
  findings: string[]
  /** Same computeContributionPercent(node, context) the detail panel's
   * contribution section already uses — undefined when not computable
   * (see that function's own "honest not-available" doc comment). */
  contributionPercent: number | undefined
}

export function buildStepNarration(node: PlanNode, context: PlanContext, expertMode: boolean): WalkthroughStepNarration {
  const entry = getGlossaryEntry(node.operatorType)
  const explanation = entry
    ? expertMode
      ? entry.shortDefinition
      : entry.longDefinition
    : getGlossaryFallback(node.rawOperatorLabel).message

  return {
    displayName: node.rawOperatorLabel,
    explanation,
    findings: node.warnings.map((w) => (expertMode ? w.longText : w.shortText)),
    contributionPercent: computeContributionPercent(node, context),
  }
}
