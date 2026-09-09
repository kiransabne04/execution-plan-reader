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
//
// Episode 34, Story 34.1 — Snowflake enrichment, not a new rule.
// `rowsRemovedByFilter` is NEVER populated for Snowflake (`buildTree.ts`
// has no source for it — `GET_QUERY_OPERATOR_STATS()` gives a Filter
// operator's own `output_rows`, but no separate "rows removed" statistic
// and no `input_rows` capture either; see Episode 33's own deliberately-
// deferred note on `input_rows` in the field catalog §11), so this rule
// could never fire for Snowflake at all before this story. Fixed by
// deriving the removed-row count for a Snowflake `filter` node from the
// difference between its single child's `actualRows` (the input) and its
// own `actualRows` (the output) — the same "input rows via children"
// technique `explodingJoin.ts` already established. Deliberately scoped to
// exactly one child: a Filter with more than one child isn't a shape this
// derivation can honestly attribute to "the input," so it's skipped rather
// than guessed. The derived case gets its own disclosure sentence stating
// this is computed, not Snowflake's own reported statistic.
import type { PlanNode } from "../parsers/normalize"
import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Derives a Snowflake Filter's removed-row count from child vs. own
 * `actualRows`, since Snowflake never reports one directly. `undefined`
 * when the shape doesn't allow an honest derivation (not a Snowflake
 * filter, not exactly one child, or either row count missing). */
function deriveSnowflakeFilterRemoved(node: PlanNode): number | undefined {
  if (node.engine !== "snowflake" || node.operatorType !== "filter" || node.children.length !== 1) return undefined
  const inputRows = node.children[0].actualRows
  const outputRows = node.actualRows
  if (inputRows === undefined || outputRows === undefined || !Number.isFinite(inputRows) || !Number.isFinite(outputRows)) return undefined
  const removed = inputRows - outputRows
  return removed > 0 ? removed : undefined
}

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
  const derivedRemoved = node.rowsRemovedByFilter === undefined ? deriveSnowflakeFilterRemoved(node) : undefined
  const isDerived = derivedRemoved !== undefined
  const rowsRemoved = node.rowsRemovedByFilter ?? derivedRemoved
  if (rowsRemoved === undefined || !Number.isFinite(rowsRemoved) || rowsRemoved <= 0) return []
  const returned = node.actualRows
  if (returned === undefined || !Number.isFinite(returned) || returned < 0) return []

  const loopMultiplier = node.loops !== undefined && node.loops > 1 ? node.loops : 1
  const totalRemoved = rowsRemoved * loopMultiplier
  if (totalRemoved < MIN_REMOVED_THRESHOLD) return []

  // An operator that ran fast, even over a lot of rows, isn't worth
  // flagging — the "execution contribution" gate this story's own healthy
  // example turns on. Only applied when timing data actually exists
  // (estimate-only plans have none — volume/ratio alone still judge those;
  // Snowflake's derived case never has actualTimeMs at all, so it's judged
  // on volume/ratio alone too, same as an estimate-only plan).
  if (node.actualTimeMs !== undefined && node.actualTimeMs * loopMultiplier < MIN_TIME_MS_FLOOR) return []

  const ratio = rowsRemoved / (rowsRemoved + returned)
  if (ratio < SELECTIVITY_RATIO_WARNING) return []

  const severity = ratio >= SELECTIVITY_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${(ratio * 100).toFixed(ratio >= 0.999 ? 1 : 0)}%`
  const loopNote = loopMultiplier > 1 ? ` across ${formatNumber(loopMultiplier)} loop executions` : ""
  const derivedNote = isDerived
    ? ` Snowflake doesn't report a "rows removed by filter" statistic directly — this figure is computed from the ` +
      `difference between this operator's own output and its single input's output.`
    : ""

  return [
    {
      ruleId: "filter-rows-discarded",
      severity,
      shortText: `Discarded ${percentText} of examined rows (${formatNumber(totalRemoved)} removed vs. ${formatNumber(returned * loopMultiplier)} returned).`,
      longText:
        `This ${node.rawOperatorLabel} examined ${formatNumber(totalRemoved + returned * loopMultiplier)} rows${loopNote} but its own ` +
        `filter discarded ${formatNumber(totalRemoved)} of them (${percentText}), returning only ` +
        `${formatNumber(returned * loopMultiplier)}.${derivedNote} The operator read substantially more rows than it returned. This ` +
        `doesn't automatically mean an index is missing — it could also be a genuinely low-selectivity condition, or ` +
        `a filter that can't be pushed into an index at all (see this app's own non-sargable-predicate/missing-index ` +
        `findings when the evidence for those specifically exists).`,
      provenance: {
        threshold: `discard_ratio ≥ ${SELECTIVITY_RATIO_WARNING}${severity === "critical" ? ` (critical at ≥ ${SELECTIVITY_RATIO_CRITICAL})` : ""}`,
        computed: ratio.toFixed(3),
        additionalConditions: [
          `total rows removed ≥ ${formatNumber(MIN_REMOVED_THRESHOLD)}`,
          `operator's own time ≥ ${MIN_TIME_MS_FLOOR} ms (when timing data exists)`,
          ...(isDerived ? ["Snowflake: rows removed derived from child.actualRows - node.actualRows (single-child filter only)"] : []),
        ],
      },
    },
  ]
}
