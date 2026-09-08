// Snowflake rule: network-time-dominant. `timeBreakdown.networkCommunicationPercentage`
// (already parsed — no new parser work) is this node's own share of ITS
// OWN elapsed time spent on network communication. This file's own
// explicit instruction requires BOTH a high percentage of this node's own
// time AND a meaningful ABSOLUTE runtime — see `snowflakeTimeBreakdownDetail.ts`'s
// own header comment for why "absolute" means `overallPercentage` (share
// of the WHOLE query) here: Snowflake has no millisecond figure to require
// instead.
//
// "Possible causes should be listed, not diagnosed" (this file's own
// explicit instruction): `longText` names several plausible reasons
// (result-set redistribution/shuffle between compute nodes, returning a
// large result set to the client, cross-region/cross-cloud data transfer)
// as a LIST of possibilities, never asserting which one actually applies
// to this specific plan.

import { dominantTimeCategory, isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Share of THIS node's own time spent on network communication, at or
 * above which it's judged a high relative share. */
export const HIGH_NETWORK_PERCENTAGE_THRESHOLD = 30

export const networkTimeDominant: Rule = (node) => {
  if (node.engine !== "snowflake") return []

  const tb = node.timeBreakdown
  const networkPct = tb?.networkCommunicationPercentage
  if (networkPct === undefined || !Number.isFinite(networkPct) || networkPct < HIGH_NETWORK_PERCENTAGE_THRESHOLD) return []
  if (!isOverallMaterial(tb)) return []

  const dominant = dominantTimeCategory(tb)
  const severity = networkPct >= 60 ? "critical" : "warning"

  return [
    {
      ruleId: "network-time-dominant",
      severity,
      shortText: `${networkPct.toFixed(1)}% of this operator's time went to network communication — a meaningful share of the whole query.`,
      longText:
        `This ${node.rawOperatorLabel} spent ${networkPct.toFixed(1)}% of its own execution time on network ` +
        `communication, and this node's own time is itself a material share (${tb!.overallPercentage!.toFixed(1)}%) of ` +
        `the query's total — this isn't a tiny operator with a high percentage of almost nothing. Possible causes ` +
        `include (not a diagnosis of which one applies here): redistributing rows between compute nodes for a join ` +
        `or aggregation that needs data reshuffled by key, returning a large result set back to the client, or data ` +
        `movement across regions/cloud providers. Identifying which one actually applies requires looking at the ` +
        `query's own shape and where it's running, not just this plan.`,
      provenance: {
        threshold: `network % of node time ≥ ${HIGH_NETWORK_PERCENTAGE_THRESHOLD}% AND node's own overall % of query time ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}%${severity === "critical" ? " (critical at ≥ 60% network)" : ""}`,
        computed: `${networkPct.toFixed(1)}% network, ${tb!.overallPercentage!.toFixed(1)}% of query${dominant ? `, dominant category: ${dominant.category}` : ""}`,
      },
    },
  ]
}
