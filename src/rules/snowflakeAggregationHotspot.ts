// Snowflake rule: aggregation-hotspot. Story 32.3's own explicit
// instruction: analyze input rows, output rows, AND time share; stay
// "mostly informational initially"; flag only when substantial runtime is
// spent aggregating an extremely large intermediate set.
//
// Reuses `snowflakeTimeBreakdownDetail.ts`'s existing `isOverallMaterial`
// dual-gate reasoning (Episode 31) rather than re-deriving its own
// "is this node's own time share worth caring about" threshold a second,
// differently-worded way — that helper already encodes the honest
// Snowflake constraint (percentage-of-query-time, not milliseconds; see
// its own header comment) this rule needs identically.
//
// Severity default is `info` per the story's own "mostly informational"
// instruction: a large aggregation consuming real time is often simply
// necessary work (a genuine GROUP BY over a big table), not a mistake —
// this rule surfaces it for awareness, escalating to `warning` only at a
// combination of extreme input volume AND heavy time share, where a
// pre-aggregation (filter earlier, aggregate in stages) is more likely
// worth investigating.

import { formatNumber } from "./format"
import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Below this many input rows, even a materially time-consuming
 * aggregation isn't "an extremely large intermediate set" — it's just an
 * aggregation that happens to be a meaningful share of a fast query. */
export const LARGE_INPUT_ROWS_THRESHOLD = 10_000_000

/** At or above this many input rows AND this overall time share, the
 * finding escalates from informational to a warning — both extreme
 * volume and heavy runtime, not just one or the other. */
export const HUGE_INPUT_ROWS_THRESHOLD = 100_000_000
export const WARNING_OVERALL_PERCENTAGE_THRESHOLD = 20

export const snowflakeAggregationHotspot: Rule = (node) => {
  if (node.engine !== "snowflake" || node.operatorType !== "aggregate") return []
  if (!isOverallMaterial(node.timeBreakdown)) return []

  const inputRows = node.children.map((c) => c.actualRows).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  if (inputRows.length === 0) return []
  const maxInputRows = Math.max(...inputRows)
  if (maxInputRows < LARGE_INPUT_ROWS_THRESHOLD) return []

  const outputRows = node.actualRows
  const overallPercentage = node.timeBreakdown!.overallPercentage!

  const severity = maxInputRows >= HUGE_INPUT_ROWS_THRESHOLD && overallPercentage >= WARNING_OVERALL_PERCENTAGE_THRESHOLD ? "warning" : "info"

  const reductionText =
    outputRows !== undefined && Number.isFinite(outputRows) && outputRows > 0
      ? ` and reduced it to ${formatNumber(outputRows)} output rows (a ${formatNumber(Math.round(maxInputRows / outputRows))}x reduction)`
      : ""

  return [
    {
      ruleId: "aggregation-hotspot",
      severity,
      shortText: `Aggregated ${formatNumber(maxInputRows)} input rows, taking about ${overallPercentage.toFixed(1)}% of the query's total time.`,
      longText:
        `This ${node.rawOperatorLabel} aggregated an intermediate set of ${formatNumber(maxInputRows)} rows${reductionText}, ` +
        `taking about ${overallPercentage.toFixed(1)}% of the query's total time. Aggregating a large intermediate ` +
        `set isn't automatically a problem — a genuine GROUP BY over a big table has to touch every row somewhere. ` +
        `This is surfaced because both the input volume and the time share are large enough to be worth knowing ` +
        `about${severity === "warning" ? ", and the combination here is extreme enough that a narrower filter " + "upstream (reducing rows before they reach this aggregation) may meaningfully help" : ""}. ` +
        `If this aggregation is already filtering as early as the query allows, this may simply be the real cost of ` +
        `the work being done.`,
      provenance: {
        threshold: `operatorType === "aggregate" AND overall time share ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}% AND max input rows ≥ ${formatNumber(LARGE_INPUT_ROWS_THRESHOLD)}${severity === "warning" ? ` (warning at input rows ≥ ${formatNumber(HUGE_INPUT_ROWS_THRESHOLD)} AND time share ≥ ${WARNING_OVERALL_PERCENTAGE_THRESHOLD}%)` : ""}`,
        computed: `${formatNumber(maxInputRows)} rows, ${overallPercentage.toFixed(1)}% time`,
      },
    },
  ]
}
