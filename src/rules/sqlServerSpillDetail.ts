// Shared machinery between `sqlServerSortSpill.ts` and
// `sqlServerHashSpill.ts` — both operators spill to tempdb through the
// exact same `<Warnings><SpillToTempDb SpillLevel="N"/></Warnings>`
// mechanism, and both need the same three pieces of enrichment (spill-
// level severity, an honest I/O attribution, runtime contribution). One
// implementation, not two independently-typed copies that could drift.

import { formatNumber } from "./format"
import type { PlanNode } from "../parsers/normalize"
import type { PlanContext } from "./types"

/** At or above this spill level, severity escalates to `critical` — a
 * reasonable heuristic (a higher SQL Server-assigned spill level generally
 * reflects a more severe spill scenario than the baseline level 1), not a
 * confirmed statement of exactly what the number encodes. This codebase's
 * own field catalog previously stated two different, mutually-inconsistent
 * claims about what the number precisely means (recursion depth vs. which
 * operator type spilled) with no verified source for either — see
 * docs/10-node-stats-field-catalog.md §6's corrected note. Neither claim is
 * repeated in any user-facing text this module generates. */
export const ELEVATED_SPILL_LEVEL_THRESHOLD = 2

export function getSpillLevel(node: PlanNode): number | undefined {
  const raw = node.attributes["Spill Level"]
  return typeof raw === "number" ? raw : undefined
}

export function spillSeverity(spillLevel: number | undefined): "warning" | "critical" {
  return spillLevel !== undefined && spillLevel >= ELEVATED_SPILL_LEVEL_THRESHOLD ? "critical" : "warning"
}

export function spillLevelText(spillLevel: number | undefined): string {
  return spillLevel !== undefined ? `level ${formatNumber(spillLevel)}` : "an unspecified level"
}

export function spillLevelExplanation(spillLevel: number | undefined): string {
  return spillLevel !== undefined && spillLevel >= ELEVATED_SPILL_LEVEL_THRESHOLD
    ? `A spill level above 1 generally indicates a more severe spill scenario than the baseline case — SQL Server ` +
      `doesn't document a precise, single-sentence meaning for this number beyond "higher is worse," so this app ` +
      `doesn't claim more certainty about the mechanism than that.`
    : `Level 1 is the baseline spill case — real disk I/O either way, but not the more elevated scenario a higher ` +
      `spill level would indicate.`
}

/** This operator's own read total, attributed (not claimed as an isolated
 * tempdb figure) to the spill. `noOwnIoReason` names why the reads can be
 * attributed this way for the specific operator calling this (e.g. "a Sort
 * reads nothing from a table itself"). */
export function readsAttributionNote(node: PlanNode, noOwnIoReason: string): string {
  const totalReads = (node.io?.bufferHits ?? 0) + (node.io?.bufferReads ?? 0)
  if (totalReads <= 0) return ""
  return (
    ` This operator's own reads totaled ${formatNumber(totalReads)} — since ${noOwnIoReason}, that's largely ` +
    `attributable to the tempdb spill activity, though SQL Server doesn't report a tempdb-specific read count ` +
    `separately from an operator's total I/O.`
  )
}

export function totalReadsFor(node: PlanNode): number {
  return (node.io?.bufferHits ?? 0) + (node.io?.bufferReads ?? 0)
}

/** Raw runtime, plus a share-of-total-query-runtime clause when the whole-
 * plan total is actually known — `operatorLabel` names the operator in the
 * sentence ("This Sort took..."/"This Hash Match took..."). */
export function runtimeContributionNote(node: PlanNode, context: PlanContext, operatorLabel: string): string {
  if (node.actualTimeMs === undefined || !Number.isFinite(node.actualTimeMs)) return ""
  const timeText = `${node.actualTimeMs.toFixed(0)}ms`
  if (context.hasActualData && context.totalActualTimeMs !== undefined && context.totalActualTimeMs > 0) {
    const share = node.actualTimeMs / context.totalActualTimeMs
    return ` This ${operatorLabel} took ${timeText} — about ${(share * 100).toFixed(1)}% of the query's total runtime.`
  }
  return ` This ${operatorLabel} took ${timeText}.`
}

/** Tempdb write counts and page counts are genuinely never present in
 * Showplan XML, for any operator — `RunTimeCountersPerThread` has no
 * write-count attribute in its schema at all. Stated once here so both
 * spill rules use identical wording rather than two slightly different
 * disclosures of the same real gap. */
export const TEMPDB_WRITES_UNAVAILABLE_NOTE =
  "SQL Server's plan output doesn't report separate tempdb write counts or page counts for a spill anywhere — only this operator's own read totals are visible, so writes and page volume can't be shown here."
