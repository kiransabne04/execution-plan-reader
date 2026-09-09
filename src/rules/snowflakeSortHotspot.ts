// Snowflake rule: sort-hotspot. Story 32.5's own explicit instruction:
// Snowflake-specific sort analysis based on time/spill evidence — and do
// NOT reuse Postgres's `work_mem` wording (Snowflake has no such setting;
// its memory comes from warehouse size, an entirely different lever —
// see `remoteSpill.ts`'s own "don't directly prescribe a warehouse
// resize" precedent, reused here for the same reason).
//
// Layers on top of the engine-agnostic `disk-spill` (unconditional
// critical the instant `spill.occurred` is true, any operator) and the
// engine-agnostic `remote-spill`/`local-spill` (byte-severity, any
// operator) the same way `sqlServerSortSpill.ts` layers Sort-specific
// detail on top of SQL Server's own generic spill rule — this rule adds
// the Sort-specific judgment (is the SORT ITSELF the cost driver here,
// via its own time share, not just "did some spill happen somewhere")
// that those generic rules don't attempt.
//
// Fires on either kind of evidence, spill or time, since a Sort can be
// expensive by either route: a huge spill even at a modest time share, or
// a large time share even without ever spilling (data fit in memory but
// there was simply a lot of it to sort). Severity follows the spill bytes
// when a spill occurred (reusing `snowflakeSpillDetail.ts`'s own byte
// tiers directly rather than a third, differently-tuned copy); when the
// only evidence is time share with no spill, this stays informational —
// a large, non-spilling sort taking real time isn't necessarily wrong,
// just worth knowing about.

import { bytesSeverity, bytesText, LOCAL_SPILL_WARNING_BYTES, LOCAL_SPILL_CRITICAL_BYTES, REMOTE_SPILL_WARNING_BYTES, REMOTE_SPILL_CRITICAL_BYTES } from "./snowflakeSpillDetail"
import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

const SORT_OPERATOR_TYPES = new Set(["sort", "sort_with_limit"])

export const snowflakeSortHotspot: Rule = (node) => {
  if (node.engine !== "snowflake" || !SORT_OPERATOR_TYPES.has(node.operatorType)) return []

  const overallPercentage = node.timeBreakdown?.overallPercentage
  const timeMaterial = isOverallMaterial(node.timeBreakdown)

  const bytesLocal = node.spill?.occurred ? node.spill.bytesLocal : undefined
  const bytesRemote = node.spill?.occurred ? node.spill.bytesRemote : undefined
  const hasSpillBytes = (bytesLocal !== undefined && Number.isFinite(bytesLocal) && bytesLocal > 0) || (bytesRemote !== undefined && Number.isFinite(bytesRemote) && bytesRemote > 0)

  if (!timeMaterial && !hasSpillBytes) return []

  // Remote spill is judged worse than local at the same byte count (see
  // snowflakeSpillDetail.ts) — check it first so an operator with both
  // local and remote spill bytes is scored by whichever is more severe.
  let severity: "info" | "warning" | "critical" = "info"
  let spillNote = ""
  if (bytesRemote !== undefined && Number.isFinite(bytesRemote) && bytesRemote > 0) {
    const remoteSeverity = bytesSeverity(bytesRemote, REMOTE_SPILL_WARNING_BYTES, REMOTE_SPILL_CRITICAL_BYTES)
    if (remoteSeverity) {
      severity = remoteSeverity
      spillNote = ` It spilled ${bytesText(bytesRemote)} to remote storage — the most expensive tier this can spill to.`
    }
  }
  if (severity === "info" && bytesLocal !== undefined && Number.isFinite(bytesLocal) && bytesLocal > 0) {
    const localSeverity = bytesSeverity(bytesLocal, LOCAL_SPILL_WARNING_BYTES, LOCAL_SPILL_CRITICAL_BYTES)
    if (localSeverity) {
      severity = localSeverity
      spillNote = ` It spilled ${bytesText(bytesLocal)} to local disk.`
    }
  }

  const timeNote = timeMaterial ? ` This sort alone took about ${overallPercentage!.toFixed(1)}% of the query's total time.` : ""
  if (!spillNote && !timeNote) return []

  return [
    {
      ruleId: "sort-hotspot",
      severity,
      shortText: `Sort is a hotspot.${timeNote}${spillNote}`,
      longText:
        `This ${node.rawOperatorLabel} is worth a closer look.${timeNote}${spillNote} Snowflake sizes a warehouse's ` +
        `available memory by warehouse size, not a per-query setting the way some other engines expose — there's no ` +
        `single knob to raise here. The levers that actually apply: reducing the row/column volume reaching this ` +
        `sort (a more selective filter earlier in the query), sorting fewer columns or narrower ones, or — if only ` +
        `a small number of rows are ultimately needed — adding or tightening a LIMIT so a top-N sort can avoid ` +
        `fully ordering the whole set. A larger warehouse is one possible angle but not automatically the right one; ` +
        `this plan alone can't say which fix applies without more context about the query and data.`,
      provenance: {
        threshold: `Snowflake Sort/SortWithLimit with overall time share ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}% OR local/remote spill bytes present`,
        computed: `${timeMaterial ? `${overallPercentage!.toFixed(1)}% time` : "no material time share"}${hasSpillBytes ? `, spilled` : ""}`,
      },
    },
  ]
}
