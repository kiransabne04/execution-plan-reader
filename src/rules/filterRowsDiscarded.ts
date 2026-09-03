// Episode 24, Story 24.2 — a scan/filter operator that read substantially
// more rows than it returned. `rowsRemovedByFilter` already exists on
// PlanNode (Episode 6's own field-catalog retrofit) — this is the rule
// that actually judges it, considering removed rows, rows returned,
// execution-time contribution, and loop count together, not any one of
// them alone. Avoid blanket index advice (this story's own instruction):
// a low-selectivity filter is a real signal worth surfacing, but this
// rule doesn't diagnose WHY (missing index, genuinely low-selectivity
// data, a filter that can't be pushed into an index at all) — that's
// `missingIndexOpportunity.ts`'s/`nonSargablePredicate.ts`'s own job when
// the evidence for those specifically exists.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many total removed rows (already loop-multiplied — see
 * below), even a 100% discard rate isn't worth flagging. */
export const MIN_REMOVED_THRESHOLD = 10_000

export const SELECTIVITY_RATIO_WARNING = 0.9
export const SELECTIVITY_RATIO_CRITICAL = 0.99

/** An operator whose OWN reported time is below this never fires,
 * regardless of ratio/volume — a real "healthy" case per this story's own
 * example (30 removed / 10 returned / 0.03ms) has trivial volume anyway,
 * but this floor is the explicit "execution contribution" gate the story
 * asks for, kept separate from the volume floor above so a genuinely
 * fast operator that happens to touch a lot of rows (an in-memory
 * sequential pass) isn't penalized just for the row count. */
const MIN_TIME_MS_FLOOR = 1

export const filterRowsDiscarded: Rule = (node) => {
  if (node.rowsRemovedByFilter === undefined || !Number.isFinite(node.rowsRemovedByFilter) || node.rowsRemovedByFilter <= 0) return []
  const returned = node.actualRows
  if (returned === undefined || !Number.isFinite(returned) || returned < 0) return []

  const loopMultiplier = node.loops !== undefined && node.loops > 1 ? node.loops : 1
  const totalRemoved = node.rowsRemovedByFilter * loopMultiplier
  if (totalRemoved < MIN_REMOVED_THRESHOLD) return []

  // An operator that ran fast, even over a lot of rows, isn't worth
  // flagging — the "execution contribution" gate this story's own healthy
  // example turns on. Only applied when timing data actually exists
  // (estimate-only plans have none — volume/ratio alone still judge those).
  if (node.actualTimeMs !== undefined && node.actualTimeMs * loopMultiplier < MIN_TIME_MS_FLOOR) return []

  const ratio = node.rowsRemovedByFilter / (node.rowsRemovedByFilter + returned)
  if (ratio < SELECTIVITY_RATIO_WARNING) return []

  const severity = ratio >= SELECTIVITY_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${(ratio * 100).toFixed(ratio >= 0.999 ? 1 : 0)}%`
  const loopNote = loopMultiplier > 1 ? ` across ${formatNumber(loopMultiplier)} loop executions` : ""

  return [
    {
      ruleId: "filter-rows-discarded",
      severity,
      shortText: `Discarded ${percentText} of examined rows (${formatNumber(totalRemoved)} removed vs. ${formatNumber(returned * loopMultiplier)} returned).`,
      longText:
        `This ${node.rawOperatorLabel} examined ${formatNumber(totalRemoved + returned * loopMultiplier)} rows${loopNote} but its own ` +
        `filter discarded ${formatNumber(totalRemoved)} of them (${percentText}), returning only ` +
        `${formatNumber(returned * loopMultiplier)}. The operator read substantially more rows than it returned. This ` +
        `doesn't automatically mean an index is missing — it could also be a genuinely low-selectivity condition, or ` +
        `a filter that can't be pushed into an index at all (see this app's own non-sargable-predicate/missing-index ` +
        `findings when the evidence for those specifically exists).`,
    },
  ]
}
