// SQL Server rule: parallel-thread-skew. Uses REAL per-thread row counts
// (`parallel.perWorker`, already parsed per Episode 25 from each real
// `RunTimeCountersPerThread` entry) to detect when a parallel operator's
// work was distributed unevenly across its worker threads — never
// inferred from the degree of parallelism alone (this file's own explicit
// instruction): DOP only says how many workers were AVAILABLE, not how the
// actual rows ended up split between them, and those are genuinely
// different facts.
//
// Thread 0 (SQL Server's own numbering — see `parseShowplanXml.ts`'s
// `derivePerThread` comment) is the coordinating/serial thread, not one of
// the parallel workers actually doing a divided share of the row-level
// work — including it in the skew calculation would compare a
// structurally different role's row count against the real workers',
// producing a misleading skew reading on a perfectly balanced parallel
// scan. Excluded here, not in the parser (the raw per-thread data itself
// stays complete and unfiltered — this exclusion is this rule's own
// analytical choice, not a data-fidelity one).

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many worker threads (excluding the coordinator), "skew"
 * isn't a meaningful concept — need at least a few threads to compare. */
export const MIN_WORKER_THREADS = 3

/** Below this many total rows across workers, even a technically-severe
 * ratio isn't worth flagging — the same materiality floor every other
 * ratio-based rule in this codebase pairs with an absolute check. */
export const MIN_TOTAL_ROWS_THRESHOLD = 10_000

/** max/median ratio at or above which the imbalance is judged severe. */
export const SEVERE_SKEW_RATIO_THRESHOLD = 3

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export const sqlServerParallelSkew: Rule = (node) => {
  if (node.engine !== "sqlserver" || !node.parallel?.perWorker) return []

  const workerRows = node.parallel.perWorker
    .filter((w) => w.label !== "Thread 0")
    .map((w) => w.rows)
    .filter((r): r is number => r !== undefined && Number.isFinite(r) && r >= 0)

  if (workerRows.length < MIN_WORKER_THREADS) return []

  const totalRows = workerRows.reduce((sum, r) => sum + r, 0)
  if (totalRows < MIN_TOTAL_ROWS_THRESHOLD) return []

  const med = median(workerRows)
  const max = Math.max(...workerRows)
  if (med <= 0) return [] // every worker at 0 except one — degenerate, not a ratio this rule can meaningfully grade

  const ratio = max / med
  if (ratio < SEVERE_SKEW_RATIO_THRESHOLD) return []

  return [
    {
      ruleId: "parallel-thread-skew",
      severity: "warning",
      shortText: `Parallel work skewed across threads: busiest thread handled ${formatNumber(max)} rows vs. a median of ${formatNumber(med)} (${ratio.toFixed(1)}x).`,
      longText:
        `This ${node.rawOperatorLabel} ran across ${formatNumber(workerRows.length)} parallel worker threads, but the ` +
        `rows weren't split evenly — the busiest thread processed ${formatNumber(max)} rows while the median thread ` +
        `processed only ${formatNumber(med)}, a ${ratio.toFixed(1)}x imbalance. When parallel work is this uneven, ` +
        `the query's real wall-clock time is governed by the slowest (busiest) thread — the other threads finish ` +
        `early and sit idle, so the parallelism isn't buying as much as the degree of parallelism alone would ` +
        `suggest. This is usually a sign of skewed data (a partitioning or hash-key value with far more rows than ` +
        `others) rather than a parallelism setting to change.`,
      provenance: {
        threshold: `max/median rows per worker thread ≥ ${SEVERE_SKEW_RATIO_THRESHOLD}x AND total rows ≥ ${formatNumber(MIN_TOTAL_ROWS_THRESHOLD)} (excludes the coordinator thread)`,
        computed: `${ratio.toFixed(2)}x (max ${formatNumber(max)}, median ${formatNumber(med)})`,
      },
    },
  ]
}
