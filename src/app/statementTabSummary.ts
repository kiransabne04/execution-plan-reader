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

// Story 20.1 — a large stored-procedure plan's batch can carry hundreds of
// statements, most of which are SQL Server control-flow (DECLARE, IF
// EXISTS, BEGIN/END) rather than a real query with its own operators.
// Reuses the two functions above rather than a third, independently-
// drifting definition of "nothing interesting here."

/** No finding worth a tab dot, and no real duration/cost figure (either
 * absent, or present but rounding to exactly "cost 0" — SQL Server still
 * emits a trivial `QueryPlan` for pure control-flow statements). */
export function isTrivialStatement(root: PlanNode): boolean {
  if (statementSeverity(root) !== undefined) return false
  const duration = formatStatementDuration(root)
  return duration === undefined || duration === "cost 0"
}

/** Which statement a batch should open on by default: the first
 * non-trivial one (a real query, or one with a finding), so a large
 * stored-procedure plan doesn't land on statement 0's `DECLARE` by sheer
 * accident of ordering. Falls back to 0 when every statement is trivial —
 * there's nothing better to prefer, and `buildStatementTabRows` below
 * already renders that degenerate case sensibly (expanded, never a
 * hidden/empty tab strip). */
export function findDefaultStatementIndex(roots: PlanNode[]): number {
  const index = roots.findIndex((root) => !isTrivialStatement(root))
  return index === -1 ? 0 : index
}

export type StatementTabRow =
  | { kind: "tab"; index: number }
  | { kind: "group"; start: number; length: number; expanded: boolean }

/** A maximal run of 2+ consecutive trivial statements — a lone trivial
 * statement between two non-trivial ones isn't worth collapsing (a
 * "group of 1" adds a click for no clutter savings). */
function findTrivialRuns(roots: PlanNode[]): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = []
  let i = 0
  while (i < roots.length) {
    if (!isTrivialStatement(roots[i])) {
      i++
      continue
    }
    let j = i + 1
    while (j < roots.length && isTrivialStatement(roots[j])) j++
    if (j - i >= 2) runs.push({ start: i, length: j - i })
    i = j
  }
  return runs
}

/**
 * The tab strip's row list: non-trivial statements and lone trivial ones
 * render as plain tabs; a trivial run of 2+ collapses into one `"group"`
 * row UNLESS it's in `expandedRunStarts` (the user clicked to expand it)
 * or it contains `activeIndex` (a restored share-link/Recent-plans
 * selection must never land inside a hidden group).
 *
 * Story 20.3: an expanded run ALWAYS keeps its own `"group"` row (with
 * `expanded: true`), immediately before the individual tab rows it
 * reveals — otherwise expanding a run of hundreds of statements had no
 * way back to collapsed, since the only control that opened it (the
 * collapsed row itself) disappeared the moment it was clicked.
 */
export function buildStatementTabRows(roots: PlanNode[], activeIndex: number, expandedRunStarts: ReadonlySet<number> = new Set()): StatementTabRow[] {
  const runs = findTrivialRuns(roots)
  const runByStart = new Map(runs.map((run) => [run.start, run]))
  const rows: StatementTabRow[] = []
  let i = 0
  while (i < roots.length) {
    const run = runByStart.get(i)
    if (!run) {
      rows.push({ kind: "tab", index: i })
      i++
      continue
    }
    const activeInsideRun = activeIndex >= run.start && activeIndex < run.start + run.length
    const expanded = expandedRunStarts.has(run.start) || activeInsideRun
    if (expanded) {
      rows.push({ kind: "group", start: run.start, length: run.length, expanded: true })
      for (let k = run.start; k < run.start + run.length; k++) rows.push({ kind: "tab", index: k })
    } else {
      rows.push({ kind: "group", start: run.start, length: run.length, expanded: false })
    }
    i = run.start + run.length
  }
  return rows
}
