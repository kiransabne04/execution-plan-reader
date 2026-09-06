// Episode 25 — Design review (downloaded "expert overlay details" PNG),
// spec §1f: Expert mode's numbers are grouped into named sections ("Rows &
// estimates", "Cost & timing", "Buffers", operator internals, "Parallelism",
// "Output columns") rather than `buildStatRows.ts`'s single flat "This
// node's numbers" table (that flat table stays exactly as-is for Beginner —
// see this file's own spec note: "Legacy note: ... full buildStatRows()
// output including gaps" is the OLD Expert behavior this file replaces).
//
// Same honesty discipline as buildStatRows.ts throughout: a row only ever
// appears when the engine actually reported the underlying figure, or as an
// explicit `isGap` "not available"/"not applicable" row for a real,
// documented engine limitation (docs/10-node-stats-field-catalog.md) —
// never a fabricated value, and never a silent blank.

import type { PlanNode } from "../../parsers/normalize"
import type { StatRow } from "./buildStatRows"
import { NOT_APPLICABLE, formatMs, formatNumber } from "./statFormat"

export interface StatSection {
  heading: string
  rows?: StatRow[]
  /** "Output columns" is prose, not a label/value table — a single
   * monospace block, same treatment as RawAttributes' own JSON block. */
  freeText?: string
}

/** `actual/estimated` (or its reciprocal, whichever is ≥ 1) plus the
 * direction the estimate was wrong in — the mock's own "1.004× under"
 * wording. Never fabricates a direction when the two are exactly equal. */
function estimateError(estimatedRows: number | undefined, actualRows: number | undefined): string | undefined {
  if (estimatedRows === undefined || actualRows === undefined || estimatedRows <= 0 || actualRows < 0) return undefined
  if (actualRows === estimatedRows) return "exact match"
  const over = actualRows > estimatedRows
  const ratio = over ? actualRows / estimatedRows : estimatedRows / actualRows
  return `${ratio.toFixed(3)}× ${over ? "over" : "under"}`
}

function rowsAndEstimatesSection(node: PlanNode): StatSection {
  const rows: StatRow[] = []
  if (node.estimatedRows !== undefined) rows.push({ label: "Plan rows", value: formatNumber(node.estimatedRows) })
  if (node.actualRows !== undefined) rows.push({ label: "Actual rows", value: formatNumber(node.actualRows) })

  const error = estimateError(node.estimatedRows, node.actualRows)
  if (error) rows.push({ label: "Estimate error", value: error })

  if (node.rowsRemovedByFilter !== undefined && node.actualRows !== undefined) {
    const removed = node.rowsRemovedByFilter
    const returned = node.actualRows
    const ratio = removed / (removed + returned)
    // Always one decimal — unlike a rule's own severity-driven percent
    // phrasing (which hides sub-percent precision except near 100%), this
    // is a plain descriptive stat shown on every node, so a value like
    // 99.6% must never round to a misleading "100%".
    const percentText = Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : undefined
    rows.push({ label: "Removed by filter", value: percentText ? `${formatNumber(removed)} · ${percentText}` : formatNumber(removed) })
    if (Number.isFinite(ratio)) rows.push({ label: "Filter selectivity", value: (1 - ratio).toFixed(4) })
  }

  if (node.planWidth !== undefined) rows.push({ label: "Plan width", value: `${formatNumber(node.planWidth)} B` })

  return { heading: "Rows & estimates", rows }
}

function costAndTimingSection(node: PlanNode): StatSection {
  const rows: StatRow[] = []

  if (node.estimatedCost !== undefined) {
    rows.push({
      label: "Startup / total cost",
      value:
        node.startupCost !== undefined
          ? `${node.startupCost.toFixed(2)} / ${node.estimatedCost.toFixed(2)}`
          : node.estimatedCost.toFixed(2),
    })
  } else if (node.engine === "snowflake") {
    rows.push({ label: "Cost", value: NOT_APPLICABLE, isGap: true })
  }

  if (node.estimatedCost !== undefined && node.actualTimeMs !== undefined && node.actualTimeMs > 0) {
    rows.push({ label: "Cost per actual ms", value: (node.estimatedCost / node.actualTimeMs).toFixed(1) })
  }

  if (node.actualTimeMs !== undefined) rows.push({ label: "Cumulated time", value: formatMs(node.actualTimeMs) })

  if (node.actualTimeMs !== undefined || node.actualTimePerExecutionMs !== undefined) {
    const perExecutionMs = node.actualTimePerExecutionMs ?? node.actualTimeMs!
    const loopCount = node.loops ?? 1
    rows.push({ label: "Per execution", value: `${formatMs(perExecutionMs)} · ${formatNumber(loopCount)} loop${loopCount === 1 ? "" : "s"}` })
  }

  if (node.actualStartupTimeMs !== undefined) rows.push({ label: "Startup time", value: formatMs(node.actualStartupTimeMs) })

  // Planning/execution time and JIT are whole-plan facts that live only on
  // the plan's root PlanNode (see JitInfo's own doc comment, normalize.ts)
  // — genuinely absent here for any other node, not an engine gap to paper
  // over with a forced row.
  if (node.planningTimeMs !== undefined || node.executionTimeMs !== undefined) {
    rows.push({
      label: "Planning / execution",
      value: `${node.planningTimeMs !== undefined ? formatMs(node.planningTimeMs) : "—"} / ${node.executionTimeMs !== undefined ? formatMs(node.executionTimeMs) : "—"}`,
    })
  }
  if (node.planningTimeMs !== undefined || node.executionTimeMs !== undefined) {
    rows.push({
      label: "JIT",
      value: node.jit?.totalMs !== undefined ? formatMs(node.jit.totalMs) : "not in this plan",
      isGap: node.jit?.totalMs === undefined,
    })
  }

  return { heading: "Cost & timing", rows }
}

function buffersSection(node: PlanNode): StatSection | undefined {
  const io = node.io
  if (!io) return undefined
  const rows: StatRow[] = []

  if (io.bufferHits !== undefined || io.bufferReads !== undefined) {
    rows.push({ label: "Shared hit / read", value: `${formatNumber(io.bufferHits ?? 0)} / ${formatNumber(io.bufferReads ?? 0)}` })
  }
  if (io.cacheHitRatio !== undefined && Number.isFinite(io.cacheHitRatio)) {
    const approxNote = node.engine === "sqlserver" ? " (approximate)" : ""
    rows.push({ label: "Cache hit ratio", value: `${(io.cacheHitRatio * 100).toFixed(1)}%${approxNote}` })
  }
  if (io.bufferDirtied !== undefined || io.bufferWritten !== undefined) {
    rows.push({ label: "Shared dirtied / written", value: `${formatNumber(io.bufferDirtied ?? 0)} / ${formatNumber(io.bufferWritten ?? 0)}` })
  }
  if (io.tempReadBlocks !== undefined || io.tempWrittenBlocks !== undefined) {
    rows.push({ label: "Temp read / written", value: `${formatNumber(io.tempReadBlocks ?? 0)} / ${formatNumber(io.tempWrittenBlocks ?? 0)}` })
  }
  if (io.ioReadTimeMs !== undefined || io.ioWriteTimeMs !== undefined) {
    rows.push({ label: "I/O read / write time", value: `${formatMs(io.ioReadTimeMs ?? 0)} / ${formatMs(io.ioWriteTimeMs ?? 0)}` })
  }
  if (io.readAheads !== undefined) {
    rows.push({ label: "Read-ahead reads", value: `${formatNumber(io.readAheads)} (prefetch, not a cache miss)` })
  }
  if (io.bytesScanned !== undefined) rows.push({ label: "Bytes scanned", value: formatNumber(io.bytesScanned) })

  return rows.length > 0 ? { heading: "Buffers", rows } : undefined
}

/** Operator internals — the mock's own "Scan internals" is the scan-family
 * case of a more general idea (spec §1f: "operator internals (filter, heap
 * fetches for index-only scans, hash batches and peak memory, sort method
 * and memory)"); the heading and rows adapt to whichever of these real
 * per-operator sub-objects this node actually carries. A node with none of
 * them (e.g. a plain Hash Join with no Hash/Sort/Memoize data attached)
 * gets no section at all — never an empty one. */
function operatorInternalsSection(node: PlanNode): StatSection | undefined {
  const isScan = node.operatorType.includes("scan")
  if (isScan) {
    const rows: StatRow[] = []
    if (node.predicate?.filter) rows.push({ label: "Filter", value: node.predicate.filter, isLongText: true })
    if (node.operatorType === "index_only_scan") {
      rows.push(
        node.heapFetches !== undefined
          ? { label: "Heap fetches", value: formatNumber(node.heapFetches) }
          : { label: "Heap fetches", value: "not captured in this plan", isGap: true },
      )
    } else if (node.heapFetches === undefined && node.engine === "postgres") {
      rows.push({ label: "Heap fetches", value: "n/a — not an index-only scan", isGap: true })
    }
    if (node.index?.type) {
      rows.push({ label: "Index type", value: node.index.type })
    } else if (node.engine === "postgres") {
      rows.push({ label: "Index type", value: "not determinable from the plan alone", isGap: true })
    } else if (node.engine === "snowflake") {
      rows.push({ label: "Index type", value: NOT_APPLICABLE, isGap: true })
    }
    return rows.length > 0 ? { heading: "Scan internals", rows } : undefined
  }

  if (node.hash) {
    const rows: StatRow[] = []
    if (node.hash.buckets !== undefined) rows.push({ label: "Hash buckets", value: formatNumber(node.hash.buckets) })
    if (node.hash.batches !== undefined) {
      const original = node.hash.originalBatches
      rows.push({
        label: "Hash batches",
        value: original !== undefined && original !== node.hash.batches ? `${formatNumber(node.hash.batches)} (originally ${formatNumber(original)})` : formatNumber(node.hash.batches),
        isWarning: original !== undefined && node.hash.batches !== original,
      })
    }
    if (node.hash.peakMemoryKb !== undefined) rows.push({ label: "Peak memory", value: `${formatNumber(node.hash.peakMemoryKb)} kB` })
    return rows.length > 0 ? { heading: "Hash internals", rows } : undefined
  }

  if (node.sort) {
    const rows: StatRow[] = []
    if (node.sort.method) rows.push({ label: "Sort method", value: node.sort.method })
    if (node.sort.spaceUsedKb !== undefined) {
      rows.push({
        label: "Sort space",
        value: `${formatNumber(node.sort.spaceUsedKb)} kB${node.sort.spaceType ? ` (${node.sort.spaceType})` : ""}`,
        isWarning: node.sort.spaceType === "disk",
      })
    }
    return rows.length > 0 ? { heading: "Sort internals", rows } : undefined
  }

  if (node.memoize) {
    const rows: StatRow[] = []
    if (node.memoize.cacheHits !== undefined || node.memoize.cacheMisses !== undefined) {
      rows.push({ label: "Cache hits / misses", value: `${formatNumber(node.memoize.cacheHits ?? 0)} / ${formatNumber(node.memoize.cacheMisses ?? 0)}` })
    }
    if (node.memoize.cacheEvictions !== undefined) rows.push({ label: "Cache evictions", value: formatNumber(node.memoize.cacheEvictions) })
    if (node.memoize.peakMemoryKb !== undefined) rows.push({ label: "Peak memory", value: `${formatNumber(node.memoize.peakMemoryKb)} kB` })
    return rows.length > 0 ? { heading: "Memoize internals", rows } : undefined
  }

  return undefined
}

function parallelismSection(node: PlanNode): StatSection | undefined {
  const parallel = node.parallel
  if (!parallel || (parallel.workersPlanned === undefined && parallel.workersLaunched === undefined && !parallel.perWorker)) return undefined
  const rows: StatRow[] = []
  if (parallel.workersPlanned !== undefined) rows.push({ label: "Workers planned", value: formatNumber(parallel.workersPlanned) })
  if (parallel.workersLaunched !== undefined) {
    const shortfall = parallel.workersPlanned !== undefined && parallel.workersLaunched < parallel.workersPlanned
    rows.push({ label: "Workers launched", value: formatNumber(parallel.workersLaunched), isWarning: shortfall })
  }
  for (const worker of parallel.perWorker ?? []) {
    const parts: string[] = []
    if (worker.rows !== undefined) parts.push(`${formatNumber(worker.rows)} rows`)
    if (worker.timeMs !== undefined) parts.push(formatMs(worker.timeMs))
    if (parts.length > 0) rows.push({ label: worker.label, value: parts.join(" · ") })
  }
  return rows.length > 0 ? { heading: "Parallelism", rows } : undefined
}

function outputColumnsSection(node: PlanNode): StatSection | undefined {
  return node.outputColumns && node.outputColumns.length > 0
    ? { heading: "Output columns", freeText: node.outputColumns.join(", ") }
    : undefined
}

/** Panel section 3, Expert mode only (Beginner keeps `buildStatRows.ts`'s
 * single flat table). Order matches the mock exactly: Rows & estimates,
 * Cost & timing, Buffers, operator internals, Parallelism, Output columns. */
export function buildExpertSections(node: PlanNode): StatSection[] {
  return [
    rowsAndEstimatesSection(node),
    costAndTimingSection(node),
    buffersSection(node),
    operatorInternalsSection(node),
    parallelismSection(node),
    outputColumnsSection(node),
  ].filter((s): s is StatSection => s !== undefined && ((s.rows?.length ?? 0) > 0 || !!s.freeText))
}
