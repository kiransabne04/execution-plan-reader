// Snowflake rule: poor-partition-pruning. Snowflake organizes table
// storage into micro-partitions and prunes (skips) the ones a filter
// condition can't match, based on each partition's own min/max metadata.
// `partitions_assigned`/`partitions_total` (promoted to `pruning.
// partitionsScanned`/`partitionsTotal` — see `derivePruning` in
// `buildTree.ts`) directly report how many of the table's partitions this
// scan actually had to read. A ratio near 1 means pruning barely
// narrowed anything down — either the filter isn't sargable/selective
// against this table's clustering, or the table simply isn't clustered on
// a column this query filters by.
//
// This is a genuinely Snowflake-specific reasoning path — no Postgres/
// SQL Server equivalent exists for this exact signal (see
// `snowflakePruningDetail.ts`'s own header comment) — one of the concrete
// ways this app treats Snowflake as its own engine with its own real
// concepts, not "Postgres with different labels."
//
// "Do not warn on a tiny table or tiny scan": a small table's total
// partition count is too low for a scanned-ratio judgment to mean
// anything (a 3-of-5-partition scan is a 60% ratio by the math, but
// there's nothing meaningful to prune at that scale) — see
// `computePruningRatio`'s own `MIN_PARTITIONS_TOTAL_THRESHOLD` floor,
// shared with `largeScanVolume.ts`.

import { computePruningRatio, POOR_PRUNING_RATIO_THRESHOLD, SEVERE_PRUNING_RATIO_THRESHOLD } from "./snowflakePruningDetail"
import { formatNumber } from "./format"
import type { Rule } from "./types"

export const poorPartitionPruning: Rule = (node) => {
  if (node.engine !== "snowflake") return []

  const pruning = computePruningRatio(node)
  if (!pruning || pruning.ratio < POOR_PRUNING_RATIO_THRESHOLD) return []

  const severity = pruning.ratio >= SEVERE_PRUNING_RATIO_THRESHOLD ? "critical" : "warning"
  const percentText = `${(pruning.ratio * 100).toFixed(1)}%`
  const scannedText = formatNumber(pruning.partitionsScanned)
  const totalText = formatNumber(pruning.partitionsTotal)

  return [
    {
      ruleId: "poor-partition-pruning",
      severity,
      shortText: `Scanned ${scannedText} of ${totalText} partitions (${percentText}) — pruning barely narrowed this down.`,
      longText:
        `This ${node.rawOperatorLabel} scanned ${scannedText} of the table's ${totalText} micro-partitions (${percentText}) ` +
        `— Snowflake's partition-pruning metadata (each partition's own min/max column values) wasn't able to skip ` +
        `most of them for this query. This usually means the filter condition isn't selective against how this table ` +
        `happens to be clustered/ordered on disk — either the filtered column doesn't correlate with insertion/` +
        `clustering order, or the condition itself isn't sargable enough for Snowflake's pruning metadata to act on. ` +
        `Clustering the table on the columns this query actually filters by, or re-writing the filter to be more ` +
        `directly comparable against a clustered column, are the usual ways to improve pruning — this plan alone ` +
        `can't say which applies to your schema.`,
      provenance: {
        threshold: `partitions_total ≥ ${formatNumber(100)} AND scanned/total ≥ ${POOR_PRUNING_RATIO_THRESHOLD}${severity === "critical" ? ` (critical at ≥ ${SEVERE_PRUNING_RATIO_THRESHOLD})` : ""}`,
        computed: `${pruning.ratio.toFixed(3)} (${scannedText} of ${totalText})`,
      },
    },
  ]
}
