// Episode 29, Story 29.2 — strengthens `parameterSensitivityNote.ts`'s own
// baseline `info` disclosure when corroborating evidence exists. This is
// deliberately NOT folded into `parameterSensitivityNote.ts` itself as a
// `Rule`: two of the three signals need OTHER nodes' already-computed
// findings (a large cardinality mismatch anywhere in the tree; a real
// propagation relationship from `cardinalityPropagation.ts`), and
// `applyRules` processes the root FIRST (`collectNodes`'s own pre-order
// walk) — by the time a `Rule` runs on the root, no other node's
// `warnings` have been populated yet in that same pass. Same constraint
// `cardinalityPropagation.ts`'s own header comment documents at length;
// this is a second pass for the same reason, run once, after
// `applyRules` finishes.
//
// This mutates ONLY the one warning this exact function is responsible
// for (`parameter-sensitivity-honesty-note`, already emitted on the root
// by `parameterSensitivityNote.ts` during the normal pass) — never another
// rule's own finding, and never invents a relationship between unrelated
// findings the way that instruction (`cardinalityPropagation.ts`'s own
// "never mutate individual Warning text to force relationships") guards
// against elsewhere. This is a rule enhancing its OWN already-emitted
// output with genuine additional evidence, which is a narrower, self-
// contained operation.
//
// Three independent signals, escalating `info` -> `warning` at 2 or more
// (never on any single signal alone — this file's own confidence-scoring
// convention, matching `severityForEstimateError`'s own "how many hold,
// not any one alone" shape in `badRowEstimate.ts`):
// - Compile vs. runtime parameter values differ materially (Story 29.1's
//   own data, SQL-Server-only — always false for other engines).
// - A large cardinality mismatch exists anywhere in the tree
//   (`bad-row-estimate` firing above `info` severity somewhere).
// - The plan shape appears sensitive — a real ancestor/descendant
//   propagation relationship exists (`cardinalityPropagation.ts`'s own
//   `linkPropagatedFindings`), meaning a bad estimate visibly cascaded
//   into a downstream symptom, not just existing in isolation.
//
// Never escalates the language past "worth investigating" — this file's
// own explicit instruction. The escalated text still never claims
// "parameter sniffing confirmed"; it names which specific signals
// corroborated each other, which is honest (real, observable facts) without
// claiming a diagnosis this app can't make from one pasted plan.

import { linkPropagatedFindings } from "./cardinalityPropagation"
import { collectAllFindings } from "./findings"
import type { PlanNode, Warning } from "../parsers/normalize"
import type { ParameterSignal, PlanContext } from "./types"

const PARAMETER_SENSITIVITY_RULE_ID = "parameter-sensitivity-honesty-note"

// Same rank/sort `applyRules` itself uses — re-sorting after this mutation
// is required, not optional: `applyRules` already sorted `root.warnings`
// by severity before this function ever runs, and escalating one entry's
// severity in place (without re-sorting) would leave it positioned among
// the tier it USED to belong to — `WarningsSection.tsx` and other direct
// `node.warnings` consumers render in array order and don't re-sort
// themselves (only the tree-wide `collectAllFindings`/`summarizePlan`
// paths do their own independent sort).
const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }

const STRONGER_EVIDENCE_PREFIX =
  "Multiple independent signals here point toward this run's specific input mattering — "

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  const match = /^['"](.*)['"]$/.exec(trimmed)
  return (match ? match[1] : trimmed).toLowerCase()
}

/** `undefined`/missing values on either side are never treated as
 * "differ" — that's absence, not evidence. */
function parametersDifferMaterially(parameters: ParameterSignal[] | undefined): string[] {
  if (!parameters) return []
  return parameters.filter((p) => p.compiledValue !== undefined && p.runtimeValue !== undefined && stripQuotes(p.compiledValue) !== stripQuotes(p.runtimeValue)).map((p) => p.name)
}

function hasLargeCardinalityMismatch(root: PlanNode): boolean {
  return collectAllFindings(root).some((f) => f.warning.ruleId === "bad-row-estimate" && f.warning.severity !== "info")
}

function planShapeAppearsSensitive(root: PlanNode): boolean {
  return linkPropagatedFindings(root).length > 0
}

/**
 * Runs once per statement, after `applyRules` — mutates the root's own
 * `parameter-sensitivity-honesty-note` warning in place (severity + an
 * appended evidence clause) when at least 2 of the 3 signals above hold.
 * A no-op when the baseline note never fired at all (no parameter/
 * placeholder signal was found in the first place — nothing to enhance).
 */
export function enhanceParameterSensitivityNote(root: PlanNode, context: PlanContext): void {
  const existing = root.warnings.find((w) => w.ruleId === PARAMETER_SENSITIVITY_RULE_ID)
  if (!existing) return

  const differingParams = parametersDifferMaterially(context.parameters)
  const signals = [differingParams.length > 0, hasLargeCardinalityMismatch(root), planShapeAppearsSensitive(root)]
  const confidence = signals.filter(Boolean).length
  if (confidence < 2) return

  const evidenceParts: string[] = []
  if (differingParams.length > 0) {
    evidenceParts.push(`the compiled and runtime values for ${differingParams.join(", ")} differ`)
  }
  if (signals[1]) evidenceParts.push("a large estimate-vs-actual row mismatch exists in this plan")
  if (signals[2]) evidenceParts.push("that mismatch appears to have propagated into a downstream symptom")

  existing.severity = "warning"
  existing.longText = `${existing.longText} ${STRONGER_EVIDENCE_PREFIX}${evidenceParts.join(", and ")} — worth investigating, though this still isn't a confirmed diagnosis of parameter sniffing.`
  root.warnings = [...root.warnings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
