// Story 5.2 — "What am I looking at" top-level summary. Synthesizes the
// highest-severity 1-3 findings across the WHOLE tree into one coherent
// paragraph — not a concatenated bullet list — and degrades gracefully to a
// reassuring "looks fine" message when nothing significant fired. See
// .claude/skills/rule-engine-authoring/SKILL.md.

import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"

export type SummarySeverity = "critical" | "warning" | "info" | "none"

export interface PlanSummary {
  text: string
  severity: SummarySeverity
  /** The findings actually synthesized into `text`, highest severity first. */
  topFindings: Warning[]
}

const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }
const MAX_FINDINGS = 3

// Used to recognize one specific, common overlap (the edge case the story
// calls out explicitly): a large-table scan feeding a downstream problem
// (an exploding join, a bad estimate, a loop blowup) on the same subtree.
// When both are among the top findings and genuinely related, the summary
// states the relationship instead of listing them as two unrelated facts.
const SCAN_FAMILIES = new Set(["seq-scan-on-large-table"])
const DOWNSTREAM_EFFECT_FAMILIES = new Set(["exploding-join", "bad-row-estimate", "high-loop-count"])

// Exported so Episode 13's complete findings list can reuse the exact same
// zero-findings copy (Story 13.1's acceptance criterion), rather than a
// second, driftable "looks fine" string.
export const NO_ISSUES_TEXT = "This plan looks straightforward — no major issues detected."

// Exported (design review) so the shell can style this lead-in clause by
// severity — e.g. bold red for critical — separately from the rest of the
// sentence, without the rendering layer re-deriving or duplicating this
// exact wording itself (`summary.text` stays the single source of truth;
// this just tells a consumer where the opener ends within it).
export const OPENERS: Record<Exclude<SummarySeverity, "none">, string> = {
  critical: "This plan has a serious issue worth fixing first: ",
  warning: "This plan works, but has room to improve: ",
  info: "This plan looks mostly fine, with a minor note: ",
}

export interface Finding {
  nodeId: string
  family: string
  warning: Warning
}

/** Rules that can fire more than once per plan suffix their ruleId with an
 * index (e.g. "missing-index-opportunity-0"); strip it so multiple
 * instances of the same theme count as one finding in the summary. Exported
 * for Episode 13's category lookup (`findingCategory.ts`), which needs the
 * same family grouping to map a suffixed ruleId to its category. */
export function ruleFamily(ruleId: string): string {
  return ruleId.replace(/-\d+$/, "")
}

function collectFindings(root: PlanNode): Finding[] {
  return collectNodes(root).flatMap((node) =>
    node.warnings.map((warning) => ({ nodeId: node.id, family: ruleFamily(warning.ruleId), warning })),
  )
}

/** Keep only the highest-severity instance per family/theme. Exported for
 * Episode 23's `queryHealth.ts`, which needs the exact same "worst instance
 * per rule family wins" reduction to turn a dimension's findings into ONE
 * penalty per family rather than one per node — not a second, independently
 * drifting copy of this logic. */
export function dedupeByFamily(findings: Finding[]): Finding[] {
  const bestByFamily = new Map<string, Finding>()
  for (const finding of findings) {
    const existing = bestByFamily.get(finding.family)
    if (!existing || SEVERITY_RANK[finding.warning.severity] < SEVERITY_RANK[existing.warning.severity]) {
      bestByFamily.set(finding.family, finding)
    }
  }
  return [...bestByFamily.values()]
}

function buildAncestryIndex(root: PlanNode): Map<string, Set<string>> {
  const ancestors = new Map<string, Set<string>>()
  const walk = (node: PlanNode, chain: string[]) => {
    ancestors.set(node.id, new Set(chain))
    node.children.forEach((child) => walk(child, [...chain, node.id]))
  }
  walk(root, [])
  return ancestors
}

function areRelated(a: Finding, b: Finding, ancestry: Map<string, Set<string>>): boolean {
  if (a.nodeId === b.nodeId) return true
  return Boolean(ancestry.get(a.nodeId)?.has(b.nodeId) || ancestry.get(b.nodeId)?.has(a.nodeId))
}

function isScanToDownstreamPair(a: Finding, b: Finding): boolean {
  return (
    (SCAN_FAMILIES.has(a.family) && DOWNSTREAM_EFFECT_FAMILIES.has(b.family)) ||
    (SCAN_FAMILIES.has(b.family) && DOWNSTREAM_EFFECT_FAMILIES.has(a.family))
  )
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text
}

function asClause(warning: Warning): string {
  return lowerFirst(warning.shortText.replace(/\.$/, ""))
}

export function summarizePlan(root: PlanNode): PlanSummary {
  const allFindings = collectFindings(root)
  if (allFindings.length === 0) {
    return { text: NO_ISSUES_TEXT, severity: "none", topFindings: [] }
  }

  const themes = dedupeByFamily(allFindings).sort(
    (a, b) => SEVERITY_RANK[a.warning.severity] - SEVERITY_RANK[b.warning.severity],
  )
  const top = themes.slice(0, MAX_FINDINGS)
  const severity = top[0].warning.severity
  const ancestry = buildAncestryIndex(root)
  const clauses = top.map((finding) => asClause(finding.warning))

  let body: string
  if (clauses.length === 1) {
    body = `${clauses[0]}.`
  } else if (clauses.length === 2 && areRelated(top[0], top[1], ancestry) && isScanToDownstreamPair(top[0], top[1])) {
    // Synthesized relationship, not two facts listed side by side — always
    // phrased cause (the scan) -> effect, regardless of which one happened
    // to sort first by severity.
    const [cause, effect] = SCAN_FAMILIES.has(top[0].family) ? [top[0], top[1]] : [top[1], top[0]]
    body = `${asClause(cause.warning)}, which likely contributes to ${asClause(effect.warning)}.`
  } else if (clauses.length === 2) {
    body = `${clauses[0]}, and ${clauses[1]}.`
  } else {
    body = `${clauses[0]}, ${clauses[1]}, and ${clauses[2]}.`
  }

  return {
    text: `${OPENERS[severity]}${body}`,
    severity,
    topFindings: top.map((finding) => finding.warning),
  }
}
