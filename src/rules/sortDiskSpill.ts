// Episode 24, Story 24.5 — Sort Method intelligence. Postgres reports a
// Sort node's own method as free text — "quicksort", "heapsort", "top-N
// heapsort", "external merge", "external sort", or (Postgres 13+)
// "incremental sort" wrapping one of the above per group. The in-memory
// methods (quicksort/heapsort/top-N heapsort/incremental sort while its
// own group sorts stay in memory) are all NORMAL, healthy behavior — this
// rule never warns on them (this story's own explicit instruction).
// "external merge"/"external sort" mean the sort spilled to disk.
//
// This deliberately overlaps with `diskSpill.ts`'s own generic critical-
// severity spill detection for Postgres Sort nodes specifically — by
// design, the same layering Story 24.4's own instruction set for hash
// batching ("keep separate... when possible"): `diskSpill.ts` is the
// unconditional "you spilled at all" signal; THIS rule adds the
// materiality judgment (only fires above a real volume floor) and splits
// severity by HOW MUCH spilled, which the generic rule doesn't do.

import { formatNumber, formatBytesCompact } from "./format"
import type { Rule } from "./types"

/** Below this, even a technically-external sort is too small to be worth
 * its own materiality-graded finding — diskSpill.ts's own unconditional
 * critical finding still covers it, this rule just doesn't ALSO fire. */
export const MATERIAL_SPACE_USED_KB_THRESHOLD = 1_024 // 1 MB

/** Above this, a disk sort gets the stronger PG-SORT-LARGE finding instead
 * of PG-SORT-DISK. */
export const LARGE_SPACE_USED_KB_THRESHOLD = 102_400 // 100 MB

export const sortDiskSpill: Rule = (node) => {
  if (node.sort?.spaceType !== "disk") return [] // in-memory sorts (or no Sort Method data at all) never warn
  const spaceUsedKb = node.sort.spaceUsedKb
  if (spaceUsedKb === undefined || spaceUsedKb < MATERIAL_SPACE_USED_KB_THRESHOLD) return []

  const isLarge = spaceUsedKb >= LARGE_SPACE_USED_KB_THRESHOLD
  const sizeText = formatBytesCompact(spaceUsedKb * 1024)
  const rowsText = node.actualRows !== undefined ? ` (${formatNumber(node.actualRows)} rows)` : ""
  const methodText = node.sort.method ?? "external sort"

  return [
    {
      ruleId: isLarge ? "sort-large" : "sort-disk",
      severity: isLarge ? "critical" : "warning",
      shortText: `Sort spilled ${sizeText} to disk (${methodText})${rowsText}.`,
      longText:
        `This Sort operation used ${methodText} and wrote ${sizeText} to disk${rowsText} — the working set didn't fit ` +
        `in the memory available for this sort. Disk is far slower than memory, so a sort this size is usually a real, ` +
        `fixable cost — a larger \`work_mem\` for this query, or reducing the row/column volume being sorted (a more ` +
        `selective filter earlier in the plan, or sorting fewer columns), are the usual fixes.`,
    },
  ]
}
