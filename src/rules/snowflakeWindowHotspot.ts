// Snowflake rule: window-hotspot. Story 32.4's own explicit instruction:
// identify expensive Window operators; recommendations must mention
// reducing upstream row volume, simplifying window sets, and examining
// partition/order keys — WITHOUT pretending Snowflake supports
// traditional indexing (a window function has no index to add; the only
// real levers are the query's own structure).
//
// Same dual-gate shape as `snowflakeAggregationHotspot.ts` (input row
// volume AND material time share) — a window function's cost scales with
// both how many rows it has to process and how many partition/order sets
// it has to build, and neither alone is damning: a huge input that's
// still fast isn't worth flagging, and a small input taking a big time
// share of an otherwise-fast query isn't really an "expensive" operator
// in absolute terms, just a big fraction of a small number.

import { formatNumber } from "./format"
import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Below this many input rows, a window function taking a material time
 * share still isn't "expensive" in absolute terms — see this file's own
 * header comment on why both gates are required together. */
export const LARGE_INPUT_ROWS_THRESHOLD = 5_000_000

/** At or above this overall time share, the finding escalates from
 * informational to a warning. */
export const WARNING_OVERALL_PERCENTAGE_THRESHOLD = 20

export const snowflakeWindowHotspot: Rule = (node) => {
  if (node.engine !== "snowflake" || node.operatorType !== "window_agg") return []
  if (!isOverallMaterial(node.timeBreakdown)) return []

  const inputRows = node.children.map((c) => c.actualRows).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  if (inputRows.length === 0) return []
  const maxInputRows = Math.max(...inputRows)
  if (maxInputRows < LARGE_INPUT_ROWS_THRESHOLD) return []

  const overallPercentage = node.timeBreakdown!.overallPercentage!
  const severity = overallPercentage >= WARNING_OVERALL_PERCENTAGE_THRESHOLD ? "warning" : "info"

  return [
    {
      ruleId: "window-hotspot",
      severity,
      shortText: `Window function processed ${formatNumber(maxInputRows)} rows, taking about ${overallPercentage.toFixed(1)}% of the query's total time.`,
      longText:
        `This ${node.rawOperatorLabel} processed an intermediate set of ${formatNumber(maxInputRows)} rows, taking ` +
        `about ${overallPercentage.toFixed(1)}% of the query's total time. Snowflake has no index to add for a window ` +
        `function — there's no "missing index" fix here the way there might be for a scan or a join. The real levers ` +
        `are the query's own structure: reducing the row volume that reaches this operator upstream (a more selective ` +
        `filter before the window runs), simplifying the window definition itself (fewer or narrower windows, or ` +
        `combining ones that share the same PARTITION BY/ORDER BY), and examining the partition and order keys — a ` +
        `window with a highly selective PARTITION BY (many small partitions) generally costs less than one with a ` +
        `few enormous partitions or an expensive ORDER BY on unsorted data.`,
      provenance: {
        threshold: `operatorType === "window_agg" AND overall time share ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}% AND max input rows ≥ ${formatNumber(LARGE_INPUT_ROWS_THRESHOLD)}${severity === "warning" ? ` (warning at time share ≥ ${WARNING_OVERALL_PERCENTAGE_THRESHOLD}%)` : ""}`,
        computed: `${formatNumber(maxInputRows)} rows, ${overallPercentage.toFixed(1)}% time`,
      },
    },
  ]
}
