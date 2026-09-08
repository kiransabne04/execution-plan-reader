// SQL Server rule: index-spool-repeated. An Index Spool goes one step
// further than a plain Table Spool (`table-spool-expensive.ts`): instead
// of just caching the child's rows as-is, SQL Server builds a TEMPORARY
// index over them on the fly, so repeated correlated lookups against the
// cached set can SEEK into it rather than scanning the whole cached copy
// each time. It shows up in the same places a Table Spool would (most
// commonly the inner side of a Nested Loop for a correlated reference),
// but the cost profile differs: building the temporary index has its own
// upfront cost, which only pays off if it's actually seeked into many
// times.
//
// Kept as a genuinely separate rule/ruleId from `table-spool-expensive.ts`
// (this file's own explicit instruction), even though the underlying
// rebind/rewind mechanics are identical and shared via
// `sqlServerSpoolDetail.ts` — the two operators represent different real
// strategies with different fix implications, and blurring them into one
// finding would obscure which one actually happened.

import {
  computeRebindRewindStats,
  rebindRewindExplanation,
  spoolSeverity,
  REPEATED_ACCESS_THRESHOLD,
} from "./sqlServerSpoolDetail"
import { formatNumber } from "./format"
import type { Rule } from "./types"

export const MIN_ROWS_THRESHOLD = 10_000

export const sqlServerIndexSpool: Rule = (node) => {
  if (node.engine !== "sqlserver" || node.rawOperatorLabel !== "Index Spool") return []

  const stats = computeRebindRewindStats(node.rebinds, node.rewinds)
  if (!stats || stats.total < REPEATED_ACCESS_THRESHOLD) return []

  const rows = node.actualRows
  const hasVolumeEvidence = (rows !== undefined && Number.isFinite(rows) && rows >= MIN_ROWS_THRESHOLD) || (node.actualTimeMs !== undefined && Number.isFinite(node.actualTimeMs) && node.actualTimeMs >= 1_000)
  if (!hasVolumeEvidence) return []

  const severity = spoolSeverity(stats)
  const rowsText = rows !== undefined ? `${formatNumber(rows)} rows` : undefined
  const timeText = node.actualTimeMs !== undefined ? `${formatNumber(Math.round(node.actualTimeMs))}ms` : undefined
  const volumeText = [rowsText, timeText].filter((t): t is string => t !== undefined).join(", ")

  return [
    {
      ruleId: "index-spool-repeated",
      severity,
      shortText: `Index Spool accessed ${formatNumber(stats.total)} times${volumeText ? ` — ${volumeText}` : ""}.`,
      longText:
        `SQL Server built a temporary index over this Index Spool's cached rows, so repeated correlated lookups ` +
        `(typically the inner side of a Nested Loop) can seek into it instead of scanning the whole cached set each ` +
        `time. ${rebindRewindExplanation(stats)} That temporary index has its own build cost — it only pays for ` +
        `itself once it's genuinely seeked into many times, which the access count here confirms is happening. If ` +
        `this shows up unexpectedly, it's usually because the query has a correlated pattern the optimizer decided ` +
        `was worth this treatment; rewriting the correlated reference (e.g. as a join, or backed by a real ` +
        `persistent index on the underlying table) is more likely to help than anything targeting the spool itself.`,
      provenance: {
        threshold: `rebinds + rewinds ≥ ${formatNumber(REPEATED_ACCESS_THRESHOLD)} AND (rows ≥ ${formatNumber(MIN_ROWS_THRESHOLD)} OR time ≥ 1,000ms)`,
        computed: `${formatNumber(stats.total)} accesses (${(stats.rebindShare * 100).toFixed(0)}% rebinds)${volumeText ? `, ${volumeText}` : ""}`,
      },
    },
  ]
}
