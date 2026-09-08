// Snowflake rule: synchronization-overhead. `timeBreakdown.synchronizationPercentage`
// is the share of this node's own time spent waiting on OTHER parallel
// workers/partitions to coordinate — a barrier/wait, not productive
// compute. This file's own explicit instruction: only trigger when
// synchronization is BOTH relatively material (a high share of this
// node's own time) AND absolutely material (a meaningful share of the
// whole query's time) — the same dual-gate `networkTimeDominant.ts` uses,
// via the same shared `snowflakeTimeBreakdownDetail.ts` helpers.

import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Share of THIS node's own time spent in synchronization, at or above
 * which it's judged relatively material. Lower than network's own
 * threshold — any meaningful synchronization share is a less expected,
 * more worth-noting pattern than network time on a data-movement
 * operator. */
export const HIGH_SYNC_PERCENTAGE_THRESHOLD = 20

export const synchronizationOverhead: Rule = (node) => {
  if (node.engine !== "snowflake") return []

  const tb = node.timeBreakdown
  const syncPct = tb?.synchronizationPercentage
  if (syncPct === undefined || !Number.isFinite(syncPct) || syncPct < HIGH_SYNC_PERCENTAGE_THRESHOLD) return []
  if (!isOverallMaterial(tb)) return []

  const severity = syncPct >= 50 ? "critical" : "warning"

  return [
    {
      ruleId: "synchronization-overhead",
      severity,
      shortText: `${syncPct.toFixed(1)}% of this operator's time went to synchronization — waiting on other parallel work, not computing.`,
      longText:
        `This ${node.rawOperatorLabel} spent ${syncPct.toFixed(1)}% of its own execution time in synchronization — ` +
        `waiting on other parallel workers or partitions to finish their own share of the work before this one could ` +
        `proceed, rather than doing productive computation itself. This node's own time is also a material share ` +
        `(${tb!.overallPercentage!.toFixed(1)}%) of the query's total, so this isn't a tiny operator with a high ` +
        `percentage of almost nothing. This usually points at UNEVEN work distribution across parallel partitions — ` +
        `one or a few partitions doing much more work than the others, with the rest sitting idle waiting — though ` +
        `this plan alone can't confirm the specific skew without per-partition detail.`,
      provenance: {
        threshold: `synchronization % of node time ≥ ${HIGH_SYNC_PERCENTAGE_THRESHOLD}% AND node's own overall % of query time ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}%${severity === "critical" ? " (critical at ≥ 50% synchronization)" : ""}`,
        computed: `${syncPct.toFixed(1)}% synchronization, ${tb!.overallPercentage!.toFixed(1)}% of query`,
      },
    },
  ]
}
