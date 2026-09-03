// Episode 24, Story 24.11 — partition-pruning evidence (`Subplans
// Removed`, an Append/MergeAppend over a partitioned table) and large
// partition fan-out. Do NOT claim poor pruning without evidence (this
// story's own explicit instruction): when Postgres actually reports
// `Subplans Removed`, that IS the evidence — nothing to flag, pruning
// happened and this plan says so. This rule only fires in the OTHER case:
// a large number of child subplans with NO pruning evidence reported at
// all, which is an honest "can't tell from this plan" observation, never
// a claim that pruning failed.

import { formatNumber } from "./format"
import type { Rule } from "./types"

const PARTITION_CONTAINER_OPERATOR_TYPES = new Set(["append", "merge_append"])

/** Below this many child subplans, fan-out isn't large enough to be worth
 * an observational note either way. */
export const LARGE_FANOUT_THRESHOLD = 20

export const partitionFanout: Rule = (node) => {
  if (!PARTITION_CONTAINER_OPERATOR_TYPES.has(node.operatorType)) return []
  if (node.pruning?.subplansRemoved !== undefined) return [] // real evidence exists — nothing to flag either way
  if (node.children.length < LARGE_FANOUT_THRESHOLD) return []

  return [
    {
      ruleId: "partition-fanout",
      severity: "info",
      shortText: `Fans out to ${formatNumber(node.children.length)} child subplans — no partition-pruning evidence captured in this plan.`,
      longText:
        `This ${node.rawOperatorLabel} fans out to ${formatNumber(node.children.length)} child subplans, with no ` +
        `"Subplans Removed" figure captured in this plan to say whether runtime partition pruning eliminated any of ` +
        `them. This is NOT a claim that pruning is working poorly — it may be pruning perfectly well, or this plan simply ` +
        `wasn't captured in a way that reports it (partition pruning evidence isn't always present depending on how the ` +
        `plan was generated). Worth a look if this fan-out is larger than the query's own filter conditions would ` +
        `suggest is necessary.`,
    },
  ]
}
