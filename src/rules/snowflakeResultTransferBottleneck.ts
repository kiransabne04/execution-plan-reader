// Snowflake rule: result-transfer-bottleneck. `io.bytesWrittenToResult`/
// `io.bytesReadFromResult` (Episode 33, Story 33.6) is the byte volume
// moving through Snowflake's result-cache transfer path — most relevant on
// a root `Result` operator returning the query's own final output back to
// the client. Distinct from scanning/computing the data (already covered
// by `large-scan-volume`/`aggregation-hotspot`/etc.) — this is specifically
// the cost of TRANSFERRING the already-computed result set.
//
// Same "byte floor alone isn't damning, needs additional evidence" shape
// `largeScanVolume.ts` already established for its own byte-volume rule —
// a large result transfer is often simply the correct, necessary cost of
// a query that genuinely needs to return a lot of data; this rule requires
// the transfer to ALSO be a material share of the query's own time before
// treating it as worth surfacing.

import { formatBytesCompact } from "./format"
import { isOverallMaterial, MATERIAL_OVERALL_PERCENTAGE_THRESHOLD } from "./snowflakeTimeBreakdownDetail"
import type { Rule } from "./types"

/** Below this many bytes, even a material time share isn't a large enough
 * result transfer to be worth its own finding. */
export const LARGE_RESULT_BYTES_THRESHOLD = 1_073_741_824 // 1 GB

/** Above this many bytes, the finding escalates to `critical` regardless
 * of which time-share tier triggered it. */
export const HUGE_RESULT_BYTES_THRESHOLD = 10_737_418_240 // 10 GB

export const snowflakeResultTransferBottleneck: Rule = (node) => {
  if (node.engine !== "snowflake" || node.operatorType !== "result") return []

  const written = node.io?.bytesWrittenToResult
  const read = node.io?.bytesReadFromResult
  const writtenValid = written !== undefined && Number.isFinite(written) && written > 0 ? written : 0
  const readValid = read !== undefined && Number.isFinite(read) && read > 0 ? read : 0
  const totalBytes = writtenValid + readValid
  if (totalBytes < LARGE_RESULT_BYTES_THRESHOLD) return []

  if (!isOverallMaterial(node.timeBreakdown)) return []
  const overallPercentage = node.timeBreakdown!.overallPercentage!

  const severity = totalBytes >= HUGE_RESULT_BYTES_THRESHOLD ? "critical" : "warning"
  const bytesText = formatBytesCompact(totalBytes)

  return [
    {
      ruleId: "result-transfer-bottleneck",
      severity,
      shortText: `Transferring the result set moved ${bytesText}, taking about ${overallPercentage.toFixed(1)}% of the query's total time.`,
      longText:
        `This ${node.rawOperatorLabel} moved ${bytesText} through Snowflake's result-transfer path, taking about ` +
        `${overallPercentage.toFixed(1)}% of the query's total time — a material share, not just a large byte count in ` +
        `isolation. This is the cost of TRANSFERRING the already-computed result set, distinct from computing it. If the ` +
        `client genuinely needs the full result set, this may simply be the real cost of returning that much data; if ` +
        `not, a more selective \`SELECT\` (fewer columns), a \`LIMIT\`, or paginating the result client-side can reduce ` +
        `how much has to move through this path.`,
      provenance: {
        threshold: `operatorType === "result" AND result-transfer bytes ≥ ${formatBytesCompact(LARGE_RESULT_BYTES_THRESHOLD)} AND overall time share ≥ ${MATERIAL_OVERALL_PERCENTAGE_THRESHOLD}%${severity === "critical" ? ` (critical at ≥ ${formatBytesCompact(HUGE_RESULT_BYTES_THRESHOLD)})` : ""}`,
        computed: `${bytesText}, ${overallPercentage.toFixed(1)}% time`,
      },
    },
  ]
}
