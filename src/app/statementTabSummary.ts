// Episode 18, Story 18.11 — the batch statement tabs' new duration figure
// and severity dot, as pure functions kept separate from the tab JSX
// itself (same "testable logic, separate from its React wrapper" split
// buildGraphElements.ts/searchNodes.ts/walkthroughSteps.ts already use in
// this codebase).

import { collectAllFindings } from "../rules/findings"
import type { PlanNode, Warning } from "../parsers/normalize"

/**
 * "Duration figure" per the AC — actual execution time when the plan has
 * it (Postgres/SQL Server's ANALYZE output), the estimated cost otherwise
 * (Snowflake, or an estimate-only plan — see estimateOnlyNote.ts) — never
 * fabricated when neither is present. Root's own value is already the
 * plan-wide total (same reasoning computeContributionPercent.ts documents:
 * actual-time/cost figures are cumulative from the top of a node's own
 * subtree, so the root already IS the total).
 */
export function formatStatementDuration(root: PlanNode): string | undefined {
  if (root.actualTimeMs !== undefined) return `${root.actualTimeMs.toFixed(1)}ms`
  if (root.estimatedCost !== undefined) return `cost ${root.estimatedCost.toFixed(0)}`
  return undefined
}

/** The worst severity anywhere in this statement's tree, restricted to
 * "critical" | "warning" — `undefined` for a clean statement OR one whose
 * only findings are info-tier. Same restriction Story 18.4's severity-ring
 * encoding already applies to a single node (`SEVERITY_RING_CLASS` in
 * `PlanNodeCard.tsx` has no "info" entry): an info finding is a note, not
 * an at-a-glance-attention signal, so it doesn't earn a tab dot either —
 * one rule, not two independently-drifting definitions of "worth
 * flagging." Uses the existing `collectAllFindings` (already
 * severity-sorted, so the first entry is the worst) rather than a second
 * severity-scan. */
export function statementSeverity(root: PlanNode): Extract<Warning["severity"], "critical" | "warning"> | undefined {
  const worst = collectAllFindings(root)[0]?.warning.severity
  return worst === "critical" || worst === "warning" ? worst : undefined
}
