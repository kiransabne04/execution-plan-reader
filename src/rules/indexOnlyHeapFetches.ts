// Episode 24, Story 24.1 — excessive heap fetches on an Index Only Scan.
// An Index Only Scan's whole appeal is answering a query from the index
// alone, without touching the underlying table (heap) at all. A "heap
// fetch" happens when a page isn't yet marked all-visible in the
// visibility map, forcing a heap visit anyway to confirm the row's
// visibility to this transaction — so a HIGH fetch count doesn't mean the
// scan is broken, it means it isn't getting the benefit it's named for.
//
// Do NOT call a high-fetch Index Only Scan simply "healthy" (this story's
// own explicit instruction) — but do NOT claim VACUUM is definitely
// required either: the real, honest causes (visibility-map coverage,
// VACUUM state, recently-modified pages between the last VACUUM and this
// query) can't be distinguished from a single pasted plan alone. See
// .claude/skills/rule-engine-authoring/SKILL.md's own parameter-
// sensitivity-honesty precedent for the same "disclose, don't diagnose"
// shape applied here.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many actual rows, even a 100% heap-fetch ratio isn't worth
 * flagging — a handful of fetches on a small scan is normal noise, not a
 * real visibility-map coverage problem. */
export const MIN_ACTUAL_ROWS_THRESHOLD = 1_000

export const HEAP_FETCH_RATIO_WARNING = 0.1
export const HEAP_FETCH_RATIO_CRITICAL = 0.5

export const indexOnlyHeapFetches: Rule = (node) => {
  if (node.operatorType !== "index_only_scan") return []
  if (node.heapFetches === undefined || node.actualRows === undefined) return []
  if (!Number.isFinite(node.heapFetches) || !Number.isFinite(node.actualRows) || node.actualRows <= 0) return []
  if (node.actualRows < MIN_ACTUAL_ROWS_THRESHOLD) return [] // suppress small/trivial cases

  const ratio = node.heapFetches / node.actualRows
  if (ratio < HEAP_FETCH_RATIO_WARNING) return []

  const severity = ratio >= HEAP_FETCH_RATIO_CRITICAL ? "critical" : "warning"
  const percentText = `${Math.round(ratio * 100)}%`

  return [
    {
      ruleId: "index-only-heap-fetches",
      severity,
      shortText: `${percentText} of rows needed a heap fetch (${formatNumber(node.heapFetches)} of ${formatNumber(node.actualRows)}) — not served from the index alone.`,
      longText:
        `This Index Only Scan returned ${formatNumber(node.actualRows)} rows but needed ${formatNumber(node.heapFetches)} ` +
        `heap fetches (${percentText}) to do it — most of its rows weren't answered from the index alone, which is the ` +
        `whole point of this scan type. A heap fetch happens when a page isn't yet marked all-visible in Postgres's ` +
        `visibility map, so the scan has to visit the table anyway to confirm row visibility. Possible causes, none ` +
        `confirmable from this one pasted plan: the table's visibility-map coverage hasn't caught up (recent writes, ` +
        `an autovacuum that hasn't run or completed since), or this table sees enough ongoing modification that pages ` +
        `rarely stay all-visible for long. This does NOT necessarily mean VACUUM needs to run right now — investigate ` +
        `visibility-map coverage and vacuum behavior for this table before assuming that's the fix.`,
    },
  ]
}
