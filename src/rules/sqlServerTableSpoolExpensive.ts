// SQL Server rule: table-spool-expensive. A Table Spool caches its child's
// full row set in tempdb/memory, most commonly on the inner side of a
// Nested Loop, so repeated correlated evaluations don't have to re-run the
// underlying subtree from scratch. SQL Server introduces one for two
// distinct reasons — either PERFORMANCE (caching an expensive subquery's
// result across many outer rows) or CORRECTNESS ("Eager Spool," most often
// seen protecting an UPDATE/DELETE/MERGE from reading and writing the same
// rows in the same pass — the classic "Halloween Protection" problem).
// `LogicalOp` names which ("Eager Spool" vs "Lazy Spool") when present.
//
// Distinguished from `Table Spool`/`Index Spool` sharing one normalized
// `operatorType: "spool"` (see `operatorMap.ts`'s own comment on why that
// taxonomy collapse is deliberate) via `rawOperatorLabel` — same technique
// used for RID vs Key Lookup and Hash Match's four logical disambiguations
// elsewhere in this episode.
//
// This file's own explicit instruction: never say "remove the spool." A
// Halloween-Protection spool is often structurally required for
// correctness, not a performance choice this app can safely suggest
// removing — and even a purely performance-motivated one isn't something
// a query hint reliably controls. The fix framing here always points at
// the UNDERLYING pattern (the correlated subquery/statement shape) rather
// than the spool operator itself.

import {
  computeRebindRewindStats,
  rebindRewindExplanation,
  spoolSeverity,
  REPEATED_ACCESS_THRESHOLD,
} from "./sqlServerSpoolDetail"
import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many rows materialized (cumulative, across every rebuild —
 * `actualRows` already reflects that since it's summed per execution),
 * even a heavily-rebuilt spool is too small to be worth its own finding —
 * `disk-spill`/other row-volume rules already cover a genuinely tiny case. */
export const MIN_ROWS_THRESHOLD = 10_000

export const sqlServerTableSpoolExpensive: Rule = (node) => {
  if (node.engine !== "sqlserver" || node.rawOperatorLabel !== "Table Spool") return []

  const stats = computeRebindRewindStats(node.rebinds, node.rewinds)
  if (!stats || stats.total < REPEATED_ACCESS_THRESHOLD) return []

  const rows = node.actualRows
  const hasVolumeEvidence = (rows !== undefined && Number.isFinite(rows) && rows >= MIN_ROWS_THRESHOLD) || (node.actualTimeMs !== undefined && Number.isFinite(node.actualTimeMs) && node.actualTimeMs >= 1_000)
  if (!hasVolumeEvidence) return []

  const severity = spoolSeverity(stats)
  const logicalOp = node.attributes["LogicalOp"]
  const spoolKind = typeof logicalOp === "string" && logicalOp.length > 0 ? logicalOp : "Spool"
  const rowsText = rows !== undefined ? `${formatNumber(rows)} rows` : undefined
  const timeText = node.actualTimeMs !== undefined ? `${formatNumber(Math.round(node.actualTimeMs))}ms` : undefined
  const volumeText = [rowsText, timeText].filter((t): t is string => t !== undefined).join(", ")

  return [
    {
      ruleId: "table-spool-expensive",
      severity,
      shortText: `Table Spool (${spoolKind}) accessed ${formatNumber(stats.total)} times${volumeText ? ` — ${volumeText}` : ""}.`,
      longText:
        `SQL Server materialized this Table Spool (${spoolKind}) — caching its child's rows so a correlated ` +
        `reference (usually the inner side of a Nested Loop) doesn't re-run the underlying subtree from scratch each ` +
        `time. ${rebindRewindExplanation(stats)} An "Eager Spool" like this one often exists for CORRECTNESS, not ` +
        `just performance — protecting a data-modification statement from reading and writing the same rows in the ` +
        `same pass (Halloween Protection) — so removing the spool itself usually isn't a safe or even available ` +
        `option. If this is purely a performance concern, look at the underlying correlated pattern instead: ` +
        `rewriting a correlated subquery as a join, or reducing how much work the correlated reference itself does, ` +
        `is more likely to help than anything targeting the spool directly.`,
      provenance: {
        threshold: `rebinds + rewinds ≥ ${formatNumber(REPEATED_ACCESS_THRESHOLD)} AND (rows ≥ ${formatNumber(MIN_ROWS_THRESHOLD)} OR time ≥ 1,000ms)`,
        computed: `${formatNumber(stats.total)} accesses (${(stats.rebindShare * 100).toFixed(0)}% rebinds)${volumeText ? `, ${volumeText}` : ""}`,
      },
    },
  ]
}
