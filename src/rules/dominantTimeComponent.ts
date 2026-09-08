// Snowflake rule: dominant-time-component. An informational summary
// naming WHICH of the five time-breakdown categories (processing, local
// disk, remote disk, network, synchronization) this node's time was
// mostly spent in — e.g. "This operator spent most of its time in remote
// I/O."
//
// Deliberately never fires when PROCESSING dominates — that's the
// expected, healthy default for most compute-bound operators, and
// announcing it on every single node would be pure noise, not
// information (the same "only surface the notable case" principle
// `executionMode.ts` (Story 28.6) already applies to Row vs. Batch mode).
// This rule exists specifically to call out when a node's time was mostly
// OVERHEAD (I/O, network, coordination) rather than real compute — a
// genuinely useful thing to know that isn't already covered by whichever
// specific warning-tier rule (`remoteSpill.ts`, `networkTimeDominant.ts`,
// `synchronizationOverhead.ts`) may or may not have separately cleared
// ITS OWN stricter threshold. Always `info` — a description, never a
// defect.

import { dominantTimeCategory, isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD, type TimeCategory } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

const CATEGORY_PHRASE: Record<TimeCategory, string> = {
  processing: "processing",
  "local disk": "local I/O",
  "remote disk": "remote I/O",
  network: "network communication",
  synchronization: "synchronization — waiting on other parallel work",
}

export const dominantTimeComponent: Rule = (node) => {
  if (node.engine !== "snowflake") return []

  const tb = node.timeBreakdown
  if (!isOverallMaterial(tb)) return []

  const dominant = dominantTimeCategory(tb)
  if (!dominant || dominant.category === "processing") return []

  const phrase = CATEGORY_PHRASE[dominant.category]

  return [
    {
      ruleId: "dominant-time-component",
      severity: "info",
      shortText: `This operator spent most of its time in ${phrase} (${dominant.percentage.toFixed(1)}%).`,
      longText:
        `This ${node.rawOperatorLabel}'s own execution time was dominated by ${phrase} (${dominant.percentage.toFixed(1)}% ` +
        `of its own time), rather than processing/compute — and this node's own time is a material share ` +
        `(${tb!.overallPercentage!.toFixed(1)}%) of the query's total. This is purely descriptive: it names where the ` +
        `time went, without claiming this is necessarily a problem worth fixing on its own — see this app's own ` +
        `more specific findings (spill, network, or synchronization rules) when the evidence clears their own ` +
        `stricter thresholds.`,
      provenance: {
        threshold: `dominant time-breakdown category ≠ processing AND node's own overall % of query time ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}%`,
        computed: `${phrase}: ${dominant.percentage.toFixed(1)}%`,
      },
    },
  ]
}
