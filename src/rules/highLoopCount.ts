// MVP rule 4: nested loop join blowup — high loop count with high per-loop
// cost. Expressed generically on loops+actualTimeMs (both already
// normalized fields) rather than specifically gated on operatorType ===
// "nested_loop_join", since SQL Server's nested-loop inner side produces
// the same signal via ActualExecutions and the pattern is worth flagging
// regardless of which join wraps it.
//
// Required suppression: actualTimeMs is already a PER-LOOP average
// (Postgres/SQL Server semantics) except when the parser has explicitly
// flagged it as a cross-thread cumulated sum (SQL Server parallelism) — in
// that case, multiplying by loops on top would compound a misleading
// figure, so this rule must not fire there. See
// .claude/skills/rule-engine-authoring/SKILL.md.

import type { Rule } from "./types"

export const LOOP_COUNT_THRESHOLD = 1_000
export const PER_LOOP_MS_THRESHOLD = 1
export const TOTAL_CONTRIBUTION_MS_THRESHOLD = 500

export const highLoopCount: Rule = (node) => {
  if (node.attributes["Actual Time Is Cumulated Across Threads"] === "true") return []

  const { loops, actualTimeMs } = node
  if (loops === undefined || actualTimeMs === undefined || !Number.isFinite(loops) || !Number.isFinite(actualTimeMs)) {
    return []
  }
  if (loops <= LOOP_COUNT_THRESHOLD || actualTimeMs <= PER_LOOP_MS_THRESHOLD) return []

  const totalMs = loops * actualTimeMs
  if (!Number.isFinite(totalMs) || totalMs < TOTAL_CONTRIBUTION_MS_THRESHOLD) return []

  return [
    {
      ruleId: "high-loop-count",
      severity: "warning",
      shortText: `Runs ${loops.toLocaleString()} times at ~${actualTimeMs.toFixed(2)}ms each — ~${Math.round(totalMs).toLocaleString()}ms total.`,
      longText:
        `This ${node.rawOperatorLabel} executes ${loops.toLocaleString()} times — typically once per row from the ` +
        `outer side of a join — each taking about ${actualTimeMs.toFixed(2)}ms, for roughly ` +
        `${Math.round(totalMs).toLocaleString()}ms total. This is the classic nested-loop-join blowup pattern: cheap ` +
        `per iteration, expensive in aggregate. A different join algorithm, or an index that makes each iteration ` +
        `cheaper, usually helps.`,
    },
  ]
}
