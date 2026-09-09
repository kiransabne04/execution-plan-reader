// Snowflake rule: dml-scope-inefficiency. Story 34.6's "DML analysis"
// theme: `dml.*` (Episode 33, Story 33.9) gives the ACTUAL row count a DML
// statement changed (inserted/updated/deleted); comparing that against how
// many rows the statement had to scan/join to find them (derived from
// children's `actualRows`, the same "input rows via children" technique
// `explodingJoin.ts`/`filterRowsDiscarded.ts` already established) answers
// a genuinely different question from either alone: was this statement's
// own WHERE/join condition well-targeted, or did it examine far more of
// the table than it ultimately needed to change?
//
// Deliberately scoped to Update/Delete/Merge only — Insert's own "rows
// read vs. rows inserted" gap is usually explained by an upstream
// aggregation/dedup step (already covered by other findings on THOSE
// operators), not a DML-targeting problem the way a wide UPDATE/DELETE/
// MERGE scan is. Reuses the same discard-ratio vocabulary and thresholds
// `filterRowsDiscarded.ts` already established (0.9 warning / 0.99
// critical) — "rows examined but not changed" is the same shape of signal
// as "rows examined but not returned," just for a write instead of a read.

import type { PlanNode } from "../parsers/normalize"
import { formatNumber } from "./format"
import { resolveInputRows } from "./inputRowsDetail"
import type { Rule } from "./types"

const SCOPED_OPERATOR_TYPES = new Set(["update", "delete", "merge"])

/** Below this many rows examined, even a 100% "examined but not changed"
 * ratio isn't worth flagging — too small to matter. */
export const MIN_INPUT_ROWS_THRESHOLD = 100_000

export const UNCHANGED_RATIO_WARNING = 0.9
export const UNCHANGED_RATIO_CRITICAL = 0.99

function totalRowsChanged(node: PlanNode): number | undefined {
  const dml = node.dml
  if (!dml) return undefined
  const parts = [dml.rowsInserted, dml.rowsUpdated, dml.rowsDeleted].filter((r): r is number => r !== undefined && Number.isFinite(r) && r >= 0)
  if (parts.length === 0) return undefined
  return parts.reduce((sum, r) => sum + r, 0)
}

export const snowflakeDmlScopeInefficiency: Rule = (node) => {
  if (node.engine !== "snowflake" || !SCOPED_OPERATOR_TYPES.has(node.operatorType)) return []

  const rowsChanged = totalRowsChanged(node)
  if (rowsChanged === undefined) return []

  const maxInputRows = resolveInputRows(node)
  if (maxInputRows === undefined || maxInputRows < MIN_INPUT_ROWS_THRESHOLD) return []
  if (rowsChanged > maxInputRows) return [] // not an honest comparison — the derivation doesn't fit this shape

  const unchangedRatio = (maxInputRows - rowsChanged) / maxInputRows
  if (unchangedRatio < UNCHANGED_RATIO_WARNING) return []

  const severity = unchangedRatio >= UNCHANGED_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${(unchangedRatio * 100).toFixed(unchangedRatio >= 0.999 ? 1 : 0)}%`

  return [
    {
      ruleId: "dml-scope-inefficiency",
      severity,
      shortText: `Examined ${formatNumber(maxInputRows)} rows to change only ${formatNumber(rowsChanged)} (${percentText} examined but not changed).`,
      longText:
        `This ${node.rawOperatorLabel} examined ${formatNumber(maxInputRows)} rows upstream but only actually changed ` +
        `${formatNumber(rowsChanged)} of them (${percentText} examined but not changed). This doesn't automatically mean ` +
        `something is wrong — some statements genuinely need to scan broadly to find a small matching set — but it's worth ` +
        `checking whether the statement's own WHERE clause or join condition (for a MERGE/correlated UPDATE/DELETE) is as ` +
        `targeted as it could be, the same way a read query's own filter selectivity would be worth checking (see this ` +
        `app's own filter-rows-discarded finding for that read-side equivalent).`,
      provenance: {
        threshold: `operatorType in {update, delete, merge} AND max input rows ≥ ${formatNumber(MIN_INPUT_ROWS_THRESHOLD)} AND (examined - changed) / examined ≥ ${UNCHANGED_RATIO_WARNING}${severity === "critical" ? ` (critical at ≥ ${UNCHANGED_RATIO_CRITICAL})` : ""}`,
        computed: unchangedRatio.toFixed(3),
      },
    },
  ]
}
