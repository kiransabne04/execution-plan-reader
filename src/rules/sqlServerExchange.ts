// SQL Server rule: exchange-data-movement. SQL Server's "Parallelism"
// physical operator covers three distinct data-movement patterns,
// disambiguated by `LogicalOp` (already promoted to `attributes["LogicalOp"]`
// — see `operatorMap.ts`'s own `mapParallelism`, which collapses
// Distribute/Repartition Streams into one `exchange` operatorType and
// Gather Streams into `gather`): Repartition Streams (redistributes rows
// across the SAME number of threads, typically to re-hash them by a
// different key for a downstream operator), Distribute Streams (splits a
// serial stream out into parallel threads), and Gather Streams (collects
// parallel threads' output back into one serial stream). Each move real
// rows between threads — the cost this rule flags is that movement itself,
// not any per-row computation.
//
// Only fires when both row volume AND runtime contribution are material
// (this file's own explicit instruction) — an Exchange moving a handful of
// rows for a few milliseconds is normal, unremarkable parallel plumbing.
//
// Timing: `actualTimeMs` here is SQL Server's raw cumulated figure (see
// `sqlServerSpillDetail.ts`'s own header comment for the fuller version of
// this point) — for an Exchange specifically, that's genuinely a
// reasonable "total aggregate work across all the threads involved in
// this movement" figure, not a single-thread duration, and is labeled as
// such whenever the thread-cumulation flag is present.

import { formatNumber } from "./format"
import type { Rule } from "./types"

const EXCHANGE_OPERATOR_TYPES = new Set(["exchange", "gather"])

/** Below this many rows moved, an Exchange isn't worth its own finding —
 * ordinary parallel plumbing. */
export const MIN_ROWS_THRESHOLD = 100_000

/** Below this cumulative time, even a large row count moved quickly isn't
 * material. */
export const MIN_TIME_MS_THRESHOLD = 500

const LOGICAL_OP_DESCRIPTIONS: Record<string, string> = {
  "Repartition Streams": "redistributing rows across the same number of parallel threads, typically to re-hash them by a different key for whatever runs next",
  "Distribute Streams": "splitting a single serial stream out into multiple parallel threads",
  "Gather Streams": "collecting multiple parallel threads' output back into one serial stream",
}

export const sqlServerExchange: Rule = (node) => {
  if (node.engine !== "sqlserver" || !EXCHANGE_OPERATOR_TYPES.has(node.operatorType)) return []

  const rows = node.actualRows
  if (rows === undefined || !Number.isFinite(rows) || rows < MIN_ROWS_THRESHOLD) return []

  const timeMs = node.actualTimeMs
  if (timeMs === undefined || !Number.isFinite(timeMs) || timeMs < MIN_TIME_MS_THRESHOLD) return []

  const logicalOp = node.attributes["LogicalOp"]
  const kind = typeof logicalOp === "string" ? logicalOp : node.rawOperatorLabel
  const description = LOGICAL_OP_DESCRIPTIONS[kind] ?? "moving rows between parallel threads"
  const isCumulated = node.attributes["Actual Time Is Cumulated Across Threads"] === "true"
  const timeText = `${formatNumber(Math.round(timeMs))}ms${isCumulated ? " (summed across threads, not one thread's wall-clock time)" : ""}`

  return [
    {
      ruleId: "exchange-data-movement",
      severity: "warning",
      shortText: `${kind} moved ${formatNumber(rows)} rows (${timeText}).`,
      longText:
        `This ${kind} operator is ${description} — ${formatNumber(rows)} rows passed through it, at a cumulative ` +
        `cost of about ${timeText}. Moving rows between threads has a real cost of its own, separate from whatever ` +
        `computation happens on either side of it; at this volume, it's worth knowing this movement is a meaningful ` +
        `part of the plan's own cost. Whether it's worth addressing depends on why the redistribution is happening — ` +
        `a different join/aggregate strategy, or a query rewritten to need less cross-thread movement, may or may ` +
        `not apply here; this plan alone doesn't say which.`,
      provenance: {
        threshold: `rows ≥ ${formatNumber(MIN_ROWS_THRESHOLD)} AND cumulative time ≥ ${formatNumber(MIN_TIME_MS_THRESHOLD)}ms`,
        computed: `${formatNumber(rows)} rows, ${timeText}`,
      },
    },
  ]
}
