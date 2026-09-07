// SQL Server rule: key-lookup-explosion. A Key Lookup (SQL Server's own
// term; RID Lookup on a heap — both normalize to `key_lookup`, see
// `operatorMap.ts`) follows a non-covering index seek: the seek found the
// right rows fast, but the index doesn't carry every column the query
// needs, so SQL Server goes back to the clustered index (or heap) once per
// matched row to fetch the rest. Fine for a handful of rows; ruinous once
// the seek matches a huge number of them — this rule flags that scale.
//
// `key_lookup` is a SQL-Server-exclusive normalized type (no Postgres/
// Snowflake equivalent — see plan-normalization skill), so this rule
// doesn't need a cross-engine guard the way `pgNestedLoopExplosion.ts`
// does for `nested_loop_join`; checking `operatorType` alone is enough,
// though `engine === "sqlserver"` is still asserted defensively.
//
// Timing semantics, read carefully (see sqlserver-plan-parsing skill and
// `parseShowplanXml.ts`'s own `actualTimePerExecutionMs` comment): SQL
// Server's `ActualElapsedms` is NOT already averaged per execution the way
// Postgres's `Actual Total Time` is — `node.actualTimeMs` is the raw sum
// across every execution (and across worker threads, if parallel), so it
// can be used directly as "approximate total time spent doing lookups"
// with no further multiplication (unlike Postgres nested-loop-explosion,
// which must multiply loops × per-loop time because Postgres's own figure
// IS already per-loop). `node.actualTimePerExecutionMs` is the parser's
// own already-normalized per-single-execution figure — used here only for
// the "average per lookup" figure in the text, never `actualTimeMs`
// divided a second time.
//
// Trigger requires loops (ActualExecutions) to be high AND at least one of
// row volume / total reads to be material — two independent floors, same
// "every factor together" shape `pgNestedLoopExplosion.ts` and
// `materializeRepeated.ts` already use, so a future threshold tweak to one
// can't accidentally become the only thing preventing a false positive.
// Timing is NOT a required gate (loops/rows/reads alone already indicate
// real work) — a "missing runtime" plan (loops/rows present, no
// `ActualElapsedms` parsed) must still be able to fire.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many executions, a Key Lookup isn't the "explosion" pattern
 * this rule targets — an ordinary, cheap bookmark lookup on a handful of
 * rows. Independent of the row/reads floor below. */
export const LOOP_COUNT_THRESHOLD = 10_000

/** Above this many executions, the finding escalates from `warning` to
 * `critical` regardless of the other signals — an order of magnitude past
 * the firing floor is unambiguously severe on its own. */
export const CRITICAL_LOOP_COUNT_THRESHOLD = 100_000

/** Row-volume materiality floor — a Key Lookup normally returns ~1 row per
 * execution, so this is nearly redundant with the loop-count floor above
 * in the common case, but stays independent for when `actualRows` and
 * `loops` genuinely diverge. */
export const ROWS_MATERIALITY_THRESHOLD = 10_000

/** Total (logical) reads materiality floor — the fallback signal when
 * `actualRows` isn't populated but I/O counters are. */
export const READS_MATERIALITY_THRESHOLD = 10_000

/** Above this cumulative time (raw `actualTimeMs` — already a true total
 * for SQL Server, not a per-loop average), the finding also escalates to
 * `critical` even if loop count alone didn't clear the critical floor. */
export const CRITICAL_CUMULATIVE_MS_THRESHOLD = 5_000

function isRowsOrReadsMaterial(actualRows: number | undefined, bufferHits: number | undefined, bufferReads: number | undefined): boolean {
  if (actualRows !== undefined && Number.isFinite(actualRows) && actualRows >= ROWS_MATERIALITY_THRESHOLD) return true
  const totalReads = (bufferHits ?? 0) + (bufferReads ?? 0)
  return Number.isFinite(totalReads) && totalReads >= READS_MATERIALITY_THRESHOLD
}

export const keyLookupExplosion: Rule = (node) => {
  if (node.engine !== "sqlserver" || node.operatorType !== "key_lookup") return []

  const { loops, actualRows, actualTimeMs, actualTimePerExecutionMs } = node
  if (loops === undefined || !Number.isFinite(loops) || loops < LOOP_COUNT_THRESHOLD) return []
  if (!isRowsOrReadsMaterial(actualRows, node.io?.bufferHits, node.io?.bufferReads)) return []

  const cumulativeMsIsMaterial = actualTimeMs !== undefined && Number.isFinite(actualTimeMs) && actualTimeMs >= CRITICAL_CUMULATIVE_MS_THRESHOLD
  const severity = loops >= CRITICAL_LOOP_COUNT_THRESHOLD || cumulativeMsIsMaterial ? "critical" : "warning"

  const totalReads = (node.io?.bufferHits ?? 0) + (node.io?.bufferReads ?? 0)
  const rowsText = actualRows !== undefined ? `${formatNumber(actualRows)} rows` : undefined
  const readsText = totalReads > 0 ? `${formatNumber(totalReads)} logical reads` : undefined
  const workText = [rowsText, readsText].filter((t): t is string => t !== undefined).join(", ")

  // Timing is enrichment, not a gate — omitted entirely on a plan where
  // this node's own ActualElapsedms wasn't parsed (the "missing runtime"
  // case), rather than fabricating a number or throwing.
  const timingNote =
    actualTimeMs !== undefined && Number.isFinite(actualTimeMs)
      ? ` This added up to approximately ${formatNumber(Math.round(actualTimeMs))}ms of cumulative time across all executions` +
        (actualTimePerExecutionMs !== undefined && Number.isFinite(actualTimePerExecutionMs)
          ? ` (~${actualTimePerExecutionMs.toFixed(3)}ms average per lookup)`
          : "") +
        ` — an approximate total, not a single measured duration.`
      : ""

  return [
    {
      ruleId: "key-lookup-explosion",
      severity,
      shortText: `Key Lookup ran ${formatNumber(loops)} times${workText ? ` (${workText})` : ""} — repeated round trips to the clustered index.`,
      longText:
        `An index seek on this branch found the matching keys efficiently, but the index it used doesn't cover ` +
        `every column this query needs — so for each of the ${formatNumber(loops)} rows the seek matched, SQL ` +
        `Server had to go back to the clustered index (a Key Lookup) to fetch the rest.${timingNote} At this scale, ` +
        `the repeated round trips likely cost more than the seek itself. A covering index — one that includes the ` +
        `columns this query reads, so the seek alone can satisfy it without a lookup — may be worth investigating. ` +
        `That's a trade-off, not a free win: a wider index costs more to store and adds write overhead to every ` +
        `INSERT/UPDATE/DELETE that touches those columns, so it's only worth it if this query runs often enough to ` +
        `justify that cost. This app never generates a CREATE INDEX statement automatically — verifying the actual ` +
        `columns needed and the write-side impact requires looking at the real schema and workload, not one pasted plan.`,
      provenance: {
        threshold: `loops ≥ ${formatNumber(LOOP_COUNT_THRESHOLD)} AND (rows ≥ ${formatNumber(ROWS_MATERIALITY_THRESHOLD)} OR reads ≥ ${formatNumber(READS_MATERIALITY_THRESHOLD)})`,
        computed: `${formatNumber(loops)} executions${workText ? `, ${workText}` : ""}`,
      },
    },
  ]
}
