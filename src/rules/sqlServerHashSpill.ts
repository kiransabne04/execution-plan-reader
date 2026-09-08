// SQL Server rule: sqlserver-hash-spill. Companion to `sqlServerSortSpill.ts`
// — same underlying `<Warnings><SpillToTempDb>` mechanism, but for a Hash
// Match's own hash table (build side) rather than a Sort's working set,
// with its own memory-pressure story: the hash table didn't fit in the
// memory grant, so part of it spilled to tempdb, and matching probe-side
// rows for the spilled partitions has to happen in a second pass once
// they're read back. `diskSpill.ts` (engine-agnostic, unconditional
// `critical`) already fires on this same node — this rule adds detail on
// top, same layering as the Sort rule.
//
// `Hash Match` covers hash joins, hash aggregates, hash distinct, and hash
// union alike (disambiguated by `LogicalOp` — see `operatorMap.ts`'s own
// comment) — checked via `rawOperatorLabel === "Hash Match"` rather than
// enumerating all four normalized `operatorType`s, since the underlying
// spill mechanism and this rule's own text apply identically regardless of
// which logical operation the Hash Match is performing.
//
// Partitions/batches: checked against this repo's own fixtures and
// `parseShowplanXml.ts` — Showplan XML has NO hash-partition or hash-
// bucket count attribute anywhere in the schema (unlike Postgres, which
// reports `Hash Batches`/`Original Hash Batches` directly in its own
// EXPLAIN output — see `HashInfo` in `normalize.ts`, Postgres-only). This
// is a genuine, stated gap, not a parser oversight to silently work around
// — `longText` says so explicitly rather than fabricating a number.
//
// "Do not blindly recommend raising server memory" (this rule's own
// explicit instruction): the fix text below deliberately lists memory
// grant size, row/column volume, and join/aggregate algorithm choice as
// co-equal possible angles — never phrased as "just give it more memory,"
// since a bigger grant for one query trades off against every other
// concurrently-running query's own memory (see `memory-grant-excessive`'s
// own concurrency-impact framing for the fuller version of that trade-off).

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

export const sqlServerHashSpill: Rule = (node, context) => {
  if (node.engine !== "sqlserver" || node.rawOperatorLabel !== "Hash Match" || !node.spill?.occurred) return []

  const spillLevel = getSpillLevel(node)
  const severity = spillSeverity(spillLevel)
  const levelText = spillLevelText(spillLevel)
  const readsNote = readsAttributionNote(node, "a Hash Match reads nothing from a table itself (its input comes from its own children)")
  const runtimeNote = runtimeContributionNote(node, context, "Hash Match")
  const totalReads = totalReadsFor(node)

  return [
    {
      ruleId: "sqlserver-hash-spill",
      severity,
      shortText: `Hash Match's hash table spilled to tempdb (${levelText}).${runtimeNote}`,
      longText:
        `This Hash Match's hash table (the build side) didn't fit in its memory grant and spilled to tempdb at ` +
        `${levelText} — SQL Server has to read the spilled partitions back from tempdb and match them against the ` +
        `probe side in a further pass, on top of the original work. ${spillLevelExplanation(spillLevel)} ` +
        `Showplan XML doesn't expose a hash-partition or bucket count for this spill the way it does for a plain ` +
        `hash table size — only the spill's occurrence and level are visible, not how many partitions were involved.` +
        `${readsNote}${runtimeNote} ${TEMPDB_WRITES_UNAVAILABLE_NOTE} A larger memory grant is only one possible ` +
        `fix, not automatically the right one — reducing the row/column volume feeding the build side (a more ` +
        `selective filter earlier, or building from the genuinely smaller input), or a different join/aggregate ` +
        `strategy the optimizer might pick with better statistics, can matter just as much; this plan alone can't ` +
        `say which one actually applies here.`,
      provenance: {
        threshold: "SQL Server Hash Match operator with a tempdb spill (Warnings/SpillToTempDb present)",
        computed: `${levelText}${totalReads > 0 ? `, ${formatNumber(totalReads)} reads` : ""}`,
      },
    },
  ]
}
