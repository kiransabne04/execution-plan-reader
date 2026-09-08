// SQL Server rule: residual-predicate-heavy. An Index Seek narrows down to
// a range using its own seek predicate, then applies whatever's left of
// the WHERE clause as a residual `Predicate` against every row the seek
// actually reads — a row that survives the seek range still has to pass
// that residual filter before it's returned. When the seek predicate barely
// narrows anything and the residual predicate does almost all the real
// elimination, "Index Seek" in the plan reads as fast/selective when the
// real cost is a near-full scan of the seek's range.
//
// More specific than the existing engine-agnostic `filterRowsDiscarded.ts`
// (Episode 24, Story 24.2), which fires on ANY operator's
// rowsRemovedByFilter/actualRows ratio+volume with no check for WHY rows
// were discarded. This rule additionally requires actual EVIDENCE of the
// seek-vs-residual split — both `predicate.indexCondition` (a real seek
// predicate exists) and `predicate.filter` (a real residual predicate
// exists) must be present — so it only fires on the specific "the seek
// wasn't the selective part" story, not any generic high-discard operator.
// The two rules are expected to coexist on the same node when both fire
// (same precedent as `nested-loop-explosion` alongside `high-loop-count`)
// — this one isn't a replacement, it's a more specific companion finding.
//
// `rowsRemovedByFilter` (already `actualRowsRead - actualRows`, computed
// once in `parseShowplanXml.ts` — see plan-normalization skill) and
// `actualRows` are reused directly, not re-derived, so this rule's numbers
// can never silently drift from what the parser/node-stats field catalog
// already establish as the source of truth for these two fields.
//
// Never claims every residual predicate is a problem: a seek that narrows
// well and only has a small residual filter left over never clears the
// ratio floor and is explicitly the "healthy" case this rule is tested
// against — the finding is about the residual predicate doing almost ALL
// the work, not merely existing.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Ratio of (rows removed by the residual predicate) to (rows the seek
 * actually read) at or above which the residual predicate — not the seek
 * — is judged to be doing almost all of the real selectivity work. */
export const RESIDUAL_RATIO_WARNING = 0.9

/** Above this ratio, the finding escalates to `critical` — the seek's own
 * contribution is now negligible. */
export const RESIDUAL_RATIO_CRITICAL = 0.99

/** Below this many rows removed by the residual predicate, even a 100%
 * residual-discard rate isn't worth flagging — a seek narrowing to a
 * handful of rows and filtering out a few more is simply normal, cheap
 * execution, not the pattern this rule targets. */
export const MIN_ROWS_REMOVED_THRESHOLD = 10_000

export const residualPredicateHeavy: Rule = (node) => {
  if (node.engine !== "sqlserver" || node.operatorType !== "index_seek") return []

  // Evidence requirement: this must be a REAL seek-then-residual-filter
  // shape, not just any node with a discard ratio. A seek predicate with
  // no residual filter is a healthy, fully-covered seek (nothing to flag).
  // A residual filter with no seek predicate at all wouldn't be an Index
  // Seek in the first place, but is checked anyway rather than assumed.
  const indexCondition = node.predicate?.indexCondition
  const residualFilter = node.predicate?.filter
  if (!indexCondition || !residualFilter) return []

  const removed = node.rowsRemovedByFilter
  const returned = node.actualRows
  if (removed === undefined || !Number.isFinite(removed) || removed <= 0) return []
  if (returned === undefined || !Number.isFinite(returned) || returned < 0) return []
  if (removed < MIN_ROWS_REMOVED_THRESHOLD) return []

  const totalRead = removed + returned
  const ratio = removed / totalRead
  if (ratio < RESIDUAL_RATIO_WARNING) return []

  const severity = ratio >= RESIDUAL_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${(ratio * 100).toFixed(ratio >= 0.999 ? 1 : 0)}%`

  return [
    {
      ruleId: "residual-predicate-heavy",
      severity,
      shortText: `Index Seek read ${formatNumber(totalRead)} rows to return ${formatNumber(returned)} — the residual predicate did ${percentText} of the filtering.`,
      longText:
        `SQL Server used an Index Seek, but the seek was not selective enough by itself; most rows were eliminated ` +
        `by a residual predicate. The seek's own condition narrowed to ${formatNumber(totalRead)} rows (Actual Rows ` +
        `Read), but only ${formatNumber(returned)} of those (Actual Rows) survived the residual filter applied ` +
        `after — ${formatNumber(removed)} rows (${percentText}) were read and then discarded, not skipped by the ` +
        `seek. This doesn't mean every residual predicate is a problem — a seek with a small residual filter left ` +
        `over is normal and expected — but at this ratio and volume, the seek's own range is doing little of the ` +
        `real work. Worth checking whether the residual condition could become part of the seek itself (e.g. an ` +
        `index covering more of the WHERE clause, or a composite key ordered to match it more closely).`,
      provenance: {
        threshold: `residual_ratio ≥ ${RESIDUAL_RATIO_WARNING}${severity === "critical" ? ` (critical at ≥ ${RESIDUAL_RATIO_CRITICAL})` : ""} AND rows removed ≥ ${formatNumber(MIN_ROWS_REMOVED_THRESHOLD)}`,
        computed: `${ratio.toFixed(3)} (${formatNumber(removed)} of ${formatNumber(totalRead)})`,
      },
    },
  ]
}
