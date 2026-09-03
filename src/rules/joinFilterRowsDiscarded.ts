// Episode 24, Story 24.3 — a join whose own residual (post-match) filter
// discarded a large share of the candidate row combinations it examined.
// `rowsRemovedByJoinFilter` is distinct from `rowsRemovedByFilter`
// (filterRowsDiscarded.ts) — this is specifically a JOIN's own condition
// discarding CANDIDATE COMBINATIONS after the join algorithm already
// matched them, not a scan's post-read filter.
//
// Do NOT diagnose one cause automatically (this story's own explicit
// instruction) — an inefficient join condition, poor join ordering, a
// cardinality estimate error upstream, or a genuinely broad intermediate
// result are all plausible, and nothing in a single pasted plan
// disambiguates them. This rule discloses the SYMPTOM, never a diagnosis.

import { formatNumber } from "./format"
import type { Rule } from "./types"

export const MIN_REMOVED_THRESHOLD = 10_000
export const JOIN_FILTER_RATIO_WARNING = 0.9
export const JOIN_FILTER_RATIO_CRITICAL = 0.99

const JOIN_OPERATOR_TYPES = new Set(["hash_join", "nested_loop_join", "merge_join", "join"])

export const joinFilterRowsDiscarded: Rule = (node) => {
  if (!JOIN_OPERATOR_TYPES.has(node.operatorType)) return []
  if (node.rowsRemovedByJoinFilter === undefined || !Number.isFinite(node.rowsRemovedByJoinFilter) || node.rowsRemovedByJoinFilter <= 0) return []
  const returned = node.actualRows
  if (returned === undefined || !Number.isFinite(returned) || returned < 0) return []

  const loopMultiplier = node.loops !== undefined && node.loops > 1 ? node.loops : 1
  const totalRemoved = node.rowsRemovedByJoinFilter * loopMultiplier
  if (totalRemoved < MIN_REMOVED_THRESHOLD) return []

  const ratio = node.rowsRemovedByJoinFilter / (node.rowsRemovedByJoinFilter + returned)
  if (ratio < JOIN_FILTER_RATIO_WARNING) return []

  const severity = ratio >= JOIN_FILTER_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${(ratio * 100).toFixed(ratio >= 0.999 ? 1 : 0)}%`
  const totalReturned = returned * loopMultiplier

  return [
    {
      ruleId: "join-filter-rows-discarded",
      severity,
      shortText: `This join's own filter discarded ${percentText} of candidate combinations (${formatNumber(totalRemoved)} of ${formatNumber(totalRemoved + totalReturned)}).`,
      longText:
        `This ${node.rawOperatorLabel} produced ${formatNumber(totalReturned)} rows after its own join filter discarded ` +
        `${formatNumber(totalRemoved)} candidate combinations (${percentText}) that the join algorithm had already matched, ` +
        `before the residual condition threw most of them away. Several things can cause this, and this one plan can't ` +
        `tell you which: an inefficient join condition, a join ordering that builds a larger-than-necessary intermediate ` +
        `result before filtering, a cardinality estimate error further up the plan, or a genuinely broad intermediate ` +
        `result for this specific query. Worth investigating the join condition and ordering, not something to fix ` +
        `by assumption.`,
    },
  ]
}
