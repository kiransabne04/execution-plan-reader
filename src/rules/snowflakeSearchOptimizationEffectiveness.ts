// Snowflake rule: search-optimization-effectiveness. The Search
// Optimization Service is a paid, opt-in feature — Story 34.4's own theme
// is a cost/benefit signal: is it actually earning its keep on THIS scan?
//
// Deliberately always `info`, never `warning`/`critical` (this is a
// cost-optimization observation, not a correctness or performance defect),
// and deliberately never says "cancel Search Optimization" or any other
// prescriptive directive — only states what fraction of the table's
// partitions the service itself managed to prune, framed as "worth
// checking whether this table/predicate combination is a good fit," the
// same non-prescriptive framing `remoteSpill.ts`'s own "don't directly
// recommend a warehouse resize" instruction established for a different
// paid-resource lever.
//
// Only fires when `searchOptimization` data is actually present on this
// node at all — a scan with no Search Optimization data simply doesn't
// have the service enabled/applicable, nothing to evaluate.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many total partitions, evaluating Search Optimization's
 * effectiveness isn't meaningful — a small table barely needs pruning help
 * from any mechanism. */
export const MIN_PARTITIONS_TOTAL_THRESHOLD = 10_000

/** At or below this share of total partitions pruned BY Search
 * Optimization specifically, the service's own contribution on this scan
 * is judged low relative to the table's size. */
export const LOW_EFFECTIVENESS_RATIO = 0.05

export const snowflakeSearchOptimizationEffectiveness: Rule = (node) => {
  if (node.engine !== "snowflake" || !node.searchOptimization) return []

  const prunedBySO = node.searchOptimization.partitionsPrunedBySearchOptimization
  const partitionsTotal = node.pruning?.partitionsTotal
  if (prunedBySO === undefined || !Number.isFinite(prunedBySO) || partitionsTotal === undefined || !Number.isFinite(partitionsTotal) || partitionsTotal <= 0) {
    return []
  }
  if (partitionsTotal < MIN_PARTITIONS_TOTAL_THRESHOLD) return []

  const ratio = prunedBySO / partitionsTotal
  if (ratio > LOW_EFFECTIVENESS_RATIO) return []

  const percentText = `${(ratio * 100).toFixed(1)}%`

  return [
    {
      ruleId: "search-optimization-effectiveness",
      severity: "info",
      shortText: `Search Optimization pruned only ${percentText} of this table's ${formatNumber(partitionsTotal)} partitions on this scan.`,
      longText:
        `This ${node.rawOperatorLabel} has the Search Optimization Service enabled, but it directly pruned only ` +
        `${formatNumber(prunedBySO)} of the table's ${formatNumber(partitionsTotal)} partitions (${percentText}) on this scan — ` +
        `a small contribution relative to the table's size. Search Optimization is a paid, opt-in feature, so its ` +
        `value depends on how well it fits the predicates actually run against this table; a low contribution here ` +
        `is worth checking against whether this specific table/predicate combination is a good fit for it, though this ` +
        `plan alone can't say whether that's true across the table's broader query workload, only this one scan.`,
      provenance: {
        threshold: `search_optimization present AND partitions_total ≥ ${formatNumber(MIN_PARTITIONS_TOTAL_THRESHOLD)} AND (partitions_pruned_by_search_optimization / partitions_total) ≤ ${LOW_EFFECTIVENESS_RATIO}`,
        computed: `${percentText} (${formatNumber(prunedBySO)} / ${formatNumber(partitionsTotal)})`,
      },
    },
  ]
}
