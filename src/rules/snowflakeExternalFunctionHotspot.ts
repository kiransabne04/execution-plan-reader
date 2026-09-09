// Snowflake rule: external-function-hotspot. Story 34.3's own theme:
// "external functions" — an ExternalFunction operator calls out to code
// running entirely outside Snowflake (typically a cloud function), so its
// cost profile is genuinely different from every other operator: real
// network round-trips to a third-party system, not local compute.
//
// Honesty boundary (deliberate, not an oversight): Snowflake's official
// OPERATOR_STATISTICS schema also exposes a richer "external_functions"
// statistics object (invocation counts, row/byte transfers, latency
// percentiles, HTTP error counts, throttling metrics) that this parser
// does NOT currently capture — verifying its exact field names wasn't
// part of Episode 33's ten stories, and fabricating field names without
// checking them against Snowflake's own docs would violate this app's own
// "never fabricate data" rule. This rule is built ONLY on fields already
// verified and captured (`timeBreakdown`, `actualRows` via children, the
// same "input rows via children" technique `explodingJoin.ts` established)
// — it can say "this took a long time relative to the query and processed
// a lot of rows," but deliberately can NOT say anything about invocation
// counts, latency percentiles, or throttling, because this app doesn't
// have that data. A future story should capture the real
// `external_functions` object (verified against Snowflake's own docs, the
// same rigor Episode 33 used) before this rule tries to say more.

import { formatNumber } from "./format"
import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Below this many input rows, an external function's time share isn't
 * about batching/volume — network latency dominates any external call
 * regardless of row count, so a small row count taking a material time
 * share is simply the expected fixed cost of one round-trip, not a signal
 * worth flagging. */
export const LARGE_INPUT_ROWS_THRESHOLD = 100_000

/** At or above this overall time share, the finding escalates from
 * informational to a warning. */
export const WARNING_OVERALL_PERCENTAGE_THRESHOLD = 25

export const snowflakeExternalFunctionHotspot: Rule = (node) => {
  if (node.engine !== "snowflake" || node.operatorType !== "external_function") return []
  if (!isOverallMaterial(node.timeBreakdown)) return []

  const inputRows = node.children.map((c) => c.actualRows).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  if (inputRows.length === 0) return []
  const maxInputRows = Math.max(...inputRows)
  if (maxInputRows < LARGE_INPUT_ROWS_THRESHOLD) return []

  const overallPercentage = node.timeBreakdown!.overallPercentage!
  const severity = overallPercentage >= WARNING_OVERALL_PERCENTAGE_THRESHOLD ? "warning" : "info"

  return [
    {
      ruleId: "external-function-hotspot",
      severity,
      shortText: `External function call processed ${formatNumber(maxInputRows)} rows, taking about ${overallPercentage.toFixed(1)}% of the query's total time.`,
      longText:
        `This ${node.rawOperatorLabel} called out to code running outside Snowflake for ${formatNumber(maxInputRows)} rows, ` +
        `taking about ${overallPercentage.toFixed(1)}% of the query's total time. Network round-trip latency to the ` +
        `external service, not local compute, is expected to dominate this operator's cost — that alone isn't a defect. ` +
        `This app doesn't currently capture Snowflake's own per-call invocation-count/latency-percentile statistics for ` +
        `external functions, so it can't say whether this specific time is explained by many small calls or a few ` +
        `large ones. What's worth checking from the query's own side: whether rows are being batched into fewer, ` +
        `larger calls to the external service rather than many small ones, and whether the row volume reaching this ` +
        `operator could be reduced with an earlier, more selective filter.`,
      provenance: {
        threshold: `operatorType === "external_function" AND overall time share ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}% AND max input rows ≥ ${formatNumber(LARGE_INPUT_ROWS_THRESHOLD)}${severity === "warning" ? ` (warning at time share ≥ ${WARNING_OVERALL_PERCENTAGE_THRESHOLD}%)` : ""}`,
        computed: `${formatNumber(maxInputRows)} rows, ${overallPercentage.toFixed(1)}% time`,
      },
    },
  ]
}
