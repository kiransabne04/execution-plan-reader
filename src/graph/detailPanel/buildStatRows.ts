// Story 6.2, panel section 3 ("This node's numbers"). Implementation follows
// docs/10-node-stats-field-catalog.md exactly rather than improvising field
// names or filling gaps with guesses — an absent field renders an honest
// "not available" row, never a blank space or a fabricated zero.

import type { PlanNode } from "../../parsers/normalize"

export interface StatRow {
  label: string
  value: string
  /** An honest "this engine/plan doesn't expose this" row, styled distinctly
   * from a real value so it never looks like missing data or a bug. */
  isGap?: boolean
  /** Flags the cumulated-vs-per-execution pair so they can be visually
   * grouped/labeled together rather than read as two unrelated numbers. */
  isCumulatedTiming?: boolean
  /** A free-text value (predicate/seek/join condition) that can be
   * arbitrarily long — StatsTable renders these as a full-width wrapped
   * block instead of squeezing them into the narrow value column of the
   * 2-column table, where a long composite condition reads badly. */
  isLongText?: boolean
}

const NOT_CAPTURED = "not captured in this plan"
const NOT_APPLICABLE = "not applicable for this engine"

// Defensive final layer: whatever upstream check let a value through, a
// non-finite number must never surface as the literal text "NaN"/"Infinity".
function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "—"
}

function formatMs(value: number): string {
  return Number.isFinite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms` : "—"
}

export function buildStatRows(node: PlanNode): StatRow[] {
  const rows: StatRow[] = []

  rows.push(...rowsRowsAndEstimate(node))
  rows.push(...rowsCost(node))
  rows.push(...rowsTime(node))
  if (node.loops !== undefined) {
    rows.push({ label: "Loops", value: formatNumber(node.loops) })
  }
  rows.push(...rowsLoopTotal(node))
  rows.push(...rowsPredicateAndIndex(node))
  rows.push(...rowsJoin(node))
  rows.push(...rowsIo(node))
  rows.push(...rowsSpill(node))
  rows.push(...rowsPruning(node))
  rows.push(...rowsParallel(node))

  return rows
}

function rowsRowsAndEstimate(node: PlanNode): StatRow[] {
  const rows: StatRow[] = []
  if (node.estimatedRows !== undefined) {
    rows.push({ label: "Estimated rows", value: formatNumber(node.estimatedRows) })
  }
  if (node.actualRows !== undefined) {
    rows.push({ label: "Actual rows", value: formatNumber(node.actualRows) })
  } else if (node.estimatedRows !== undefined) {
    // Only worth stating the gap when there WAS an estimate to compare
    // against — otherwise this row would just be noise on every node.
    rows.push({ label: "Actual rows", value: "no actual run data available for this node", isGap: true })
  }
  if (node.rowsRemovedByFilter !== undefined) {
    rows.push({ label: "Rows removed by filter", value: formatNumber(node.rowsRemovedByFilter) })
  }
  return rows
}

function rowsCost(node: PlanNode): StatRow[] {
  if (node.estimatedCost === undefined) {
    // Snowflake doesn't expose an abstract cost-unit concept at all — an
    // honest gap, not a fabricated zero (field catalog §4).
    return node.engine === "snowflake" ? [{ label: "Cost", value: NOT_APPLICABLE, isGap: true }] : []
  }
  return [{ label: "Total cost", value: formatNumber(node.estimatedCost) }]
}

/** The two-row cumulated/per-execution split only appears when the two
 * figures actually DIFFER — for Postgres they're always equal (Postgres's
 * own actualTimeMs is already loop-averaged, see the field catalog's
 * correction), so showing both there would just be the same number twice. */
function rowsTime(node: PlanNode): StatRow[] {
  if (node.engine === "snowflake") {
    // Snowflake never reports actualTimeMs at all (see field catalog §7 —
    // it isn't a comparable ms figure); timeBreakdown's overallPercentage is
    // Snowflake's own honest equivalent, not a gap to fall through past.
    return node.timeBreakdown?.overallPercentage !== undefined
      ? [{ label: "Time (% of query)", value: `${node.timeBreakdown.overallPercentage}%` }]
      : [{ label: "Time", value: "no execution-time breakdown available for this node", isGap: true }]
  }
  if (node.actualTimeMs === undefined) {
    return node.estimatedCost !== undefined || node.estimatedRows !== undefined
      ? [{ label: "Time", value: "no actual run data available for this node", isGap: true }]
      : []
  }
  if (node.actualTimePerExecutionMs !== undefined && node.actualTimePerExecutionMs !== node.actualTimeMs) {
    const threads = node.parallel?.workersLaunched
    const axis = threads && threads > 1 ? `${threads} workers/threads` : "loops"
    return [
      { label: `Total (cumulated across ${axis})`, value: formatMs(node.actualTimeMs), isCumulatedTiming: true },
      { label: "Per-execution (approx.)", value: formatMs(node.actualTimePerExecutionMs), isCumulatedTiming: true },
    ]
  }
  return [{ label: "Time", value: formatMs(node.actualTimeMs) }]
}

/** Design review — a high loop count can hide a large real total behind a
 * small-looking per-loop number (the field catalog §7/§8 convention:
 * Postgres's `actualRows`/`actualTimeMs` are already PER-LOOP-ITERATION
 * AVERAGES, not totals — official Postgres docs: "actual rows" is per-
 * execution, rounded, and the true total is only approximately
 * `rows × loops`, off by up to half the loop count when it doesn't divide
 * evenly). Surfaced explicitly here rather than leaving the reader to do
 * that multiplication themselves — high-loop nested-loop-join blowups are
 * a real, common performance pattern (see `rules/highLoopCount.ts`, which
 * already computes this same total but only for its own warning
 * threshold; this row shows it unconditionally whenever loops > 1).
 *
 * Postgres only, deliberately: SQL Server's `actualRows`/`actualTimeMs`
 * are already real totals in this app's normalized model (thread-summed
 * in `parseShowplanXml.ts`, per SQL Server's own opposite convention —
 * see that file's comment), so multiplying by `loops` there would double-
 * count. Snowflake has no loop/re-execution concept at the operator level
 * at all (field catalog §7). */
function rowsLoopTotal(node: PlanNode): StatRow[] {
  if (node.engine !== "postgres" || node.loops === undefined || node.loops <= 1) return []
  const rows: StatRow[] = []
  if (node.actualRows !== undefined) {
    rows.push({ label: "Total rows (≈, all loops)", value: formatNumber(Math.round(node.actualRows * node.loops)) })
  }
  if (node.actualTimeMs !== undefined) {
    rows.push({ label: "Total time (≈, all loops)", value: formatMs(node.actualTimeMs * node.loops) })
  }
  return rows
}

function rowsPredicateAndIndex(node: PlanNode): StatRow[] {
  const rows: StatRow[] = []
  // Free text, potentially long (a composite condition across several
  // columns) — rendered as a full-width block, not a cramped table cell.
  if (node.predicate?.filter) rows.push({ label: "Filter", value: node.predicate.filter, isLongText: true })
  if (node.predicate?.indexCondition) {
    rows.push({ label: "Index condition", value: node.predicate.indexCondition, isLongText: true })
  }
  if (node.predicate?.joinCondition) {
    rows.push({ label: "Join condition", value: node.predicate.joinCondition, isLongText: true })
  }

  if (node.index?.name) rows.push({ label: "Index name", value: node.index.name })
  if (node.index?.name || node.index?.type) {
    if (node.index?.type) {
      rows.push({ label: "Index type", value: node.index.type })
    } else if (node.engine === "postgres") {
      // Postgres doesn't reliably restate the access method on the node
      // itself — an honest, explicitly-stated gap (field catalog §2),
      // never guessed from the operator's Node Type.
      rows.push({ label: "Index type", value: "not determinable from the plan alone", isGap: true })
    } else if (node.engine === "snowflake") {
      rows.push({ label: "Index type", value: NOT_APPLICABLE, isGap: true })
    }
  }
  if (node.index?.scanDirection) rows.push({ label: "Scan direction", value: node.index.scanDirection })

  return rows
}

function rowsJoin(node: PlanNode): StatRow[] {
  return node.join?.logicalType ? [{ label: "Join type", value: node.join.logicalType.replace(/_/g, " ") }] : []
}

function rowsIo(node: PlanNode): StatRow[] {
  const rows: StatRow[] = []
  if (node.io?.bufferHits !== undefined) rows.push({ label: "Buffer hits", value: formatNumber(node.io.bufferHits) })
  if (node.io?.bufferReads !== undefined) rows.push({ label: "Disk reads", value: formatNumber(node.io.bufferReads) })
  if (node.io?.cacheHitRatio !== undefined && Number.isFinite(node.io.cacheHitRatio)) {
    const approxNote = node.engine === "sqlserver" ? " (approximate)" : ""
    rows.push({ label: "Cache hit ratio", value: `${(node.io.cacheHitRatio * 100).toFixed(1)}%${approxNote}` })
  }
  if (node.io?.ioReadTimeMs !== undefined) rows.push({ label: "I/O read time", value: formatMs(node.io.ioReadTimeMs) })
  if (node.io?.ioWriteTimeMs !== undefined) rows.push({ label: "I/O write time", value: formatMs(node.io.ioWriteTimeMs) })
  if (node.io?.bytesScanned !== undefined) rows.push({ label: "Bytes scanned", value: formatNumber(node.io.bytesScanned) })

  if (rows.length === 0 && node.engine === "postgres" && (node.operatorType === "seq_scan" || node.operatorType === "index_scan")) {
    // Buffer stats require EXPLAIN (ANALYZE, BUFFERS) — absence isn't a
    // zero-I/O result, it's a setting that wasn't enabled (field catalog §5).
    rows.push({ label: "Buffers", value: `${NOT_CAPTURED} — re-run with EXPLAIN (ANALYZE, BUFFERS)`, isGap: true })
  }
  return rows
}

function rowsSpill(node: PlanNode): StatRow[] {
  if (!node.spill?.occurred) return []
  const parts: string[] = []
  if (node.spill.bytesLocal) parts.push(`${formatNumber(node.spill.bytesLocal)} bytes local`)
  if (node.spill.bytesRemote) parts.push(`${formatNumber(node.spill.bytesRemote)} bytes remote`)
  const detail = parts.length > 0 ? parts.join(", ") : (node.spill.detail ?? "yes")
  return [{ label: "Spilled to disk", value: detail }]
}

function rowsPruning(node: PlanNode): StatRow[] {
  if (node.pruning?.partitionsScanned === undefined && node.pruning?.partitionsTotal === undefined) return []
  const scanned = node.pruning.partitionsScanned !== undefined ? formatNumber(node.pruning.partitionsScanned) : "?"
  const total = node.pruning.partitionsTotal !== undefined ? formatNumber(node.pruning.partitionsTotal) : "?"
  return [{ label: "Partitions scanned", value: `${scanned} of ${total}` }]
}

function rowsParallel(node: PlanNode): StatRow[] {
  const rows: StatRow[] = []
  if (node.parallel?.workersPlanned !== undefined) rows.push({ label: "Workers planned", value: formatNumber(node.parallel.workersPlanned) })
  if (node.parallel?.workersLaunched !== undefined) rows.push({ label: "Workers launched", value: formatNumber(node.parallel.workersLaunched) })
  return rows
}
