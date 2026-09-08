// SQL Server rule: sqlserver-sort-spill. `diskSpill.ts` already fires
// (unconditional, always `critical`) the moment `node.spill.occurred` is
// true, on ANY engine — this rule adds SQL-Server-specific detail on top
// of that same signal for a `Sort` operator specifically, the same
// layering `sortDiskSpill.ts` (Postgres) already established for its own
// engine: the generic rule is "you spilled at all," this one adds the
// materiality/detail judgment the generic one doesn't attempt.
//
// Scoped to `operatorType === "sort"` only, matching this rule's own name
// — a Hash Match spill (hash join/aggregate/union spilling to tempdb) is a
// real, separate case with its own rule, `sqlServerHashSpill.ts`, since a
// hash spill's own memory-pressure story and "don't recommend memory"
// caveat are different enough to warrant separate text rather than a
// shared, blurrier one. Shared machinery (spill-level severity, I/O
// attribution, runtime contribution) lives in `sqlServerSpillDetail.ts` so
// the two rules don't duplicate that logic.
//
// What's actually available from Showplan XML for a tempdb spill —
// checked against this repo's own SQL Server fixtures and
// `parseShowplanXml.ts`, not assumed: spill level (already promoted to
// `attributes["Spill Level"]`), this operator's own I/O (an attribution,
// not an isolated tempdb figure), and runtime — see
// `sqlServerSpillDetail.ts`'s own header comment for the full accounting
// of what's genuinely NOT available (tempdb writes/pages) and why this
// rule doesn't claim more certainty about spill-level semantics than "a
// higher number is generally worse."

import {
  getSpillLevel,
  readsAttributionNote,
  runtimeContributionNote,
  spillLevelExplanation,
  spillLevelText,
  spillSeverity,
  totalReadsFor,
  TEMPDB_WRITES_UNAVAILABLE_NOTE,
} from "./sqlServerSpillDetail"
import { formatNumber } from "./format"
import type { Rule } from "./types"

export { ELEVATED_SPILL_LEVEL_THRESHOLD } from "./sqlServerSpillDetail"

export const sqlServerSortSpill: Rule = (node, context) => {
  if (node.engine !== "sqlserver" || node.operatorType !== "sort" || !node.spill?.occurred) return []

  const spillLevel = getSpillLevel(node)
  const severity = spillSeverity(spillLevel)
  const levelText = spillLevelText(spillLevel)
  const readsNote = readsAttributionNote(node, "a Sort reads nothing from a table itself")
  const runtimeNote = runtimeContributionNote(node, context, "Sort")
  const totalReads = totalReadsFor(node)

  return [
    {
      ruleId: "sqlserver-sort-spill",
      severity,
      shortText: `Sort spilled to tempdb (${levelText}).${runtimeNote}`,
      longText:
        `This Sort operation didn't fit in its memory grant and spilled to tempdb at ${levelText}. ` +
        `${spillLevelExplanation(spillLevel)} ` +
        `${readsNote}${runtimeNote} ${TEMPDB_WRITES_UNAVAILABLE_NOTE} A larger memory grant for this query, or ` +
        `reducing the row/column volume being sorted, are the usual fixes for a spill this rule can actually see ` +
        `evidence of.`,
      provenance: {
        threshold: "SQL Server Sort operator with a tempdb spill (Warnings/SpillToTempDb present)",
        computed: `${levelText}${totalReads > 0 ? `, ${formatNumber(totalReads)} reads` : ""}`,
      },
    },
  ]
}
