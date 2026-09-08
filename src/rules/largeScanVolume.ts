// Snowflake rule: large-scan-volume. `io.bytesScanned` is a genuinely
// Snowflake-specific field (no Postgres/SQL Server equivalent — see
// `IoInfo`'s own doc comment in normalize.ts) — the actual bytes this scan
// read off storage, independent of row count (a scan can read a huge
// number of bytes while returning very few rows, e.g. wide columns or
// poor pruning; row count alone wouldn't show that).
//
// This file's own explicit instruction: do NOT assume a large scan is bad
// merely because it's large. A big table scanning a big absolute volume
// of bytes is often simply doing real, necessary work efficiently. This
// rule requires ADDITIONAL evidence beyond raw size before firing — either
// this node's own share of the query's total time was material
// (`timeBreakdown.overallPercentage` — Snowflake's own per-operator time
// concept is a percentage of total query time, NOT a millisecond figure
// the way Postgres/SQL Server report it; see `TimeBreakdownInfo`'s own
// doc comment), OR pruning evidence on this same node is already poor
// (reusing `snowflakePruningDetail.ts`'s own judgment directly — this is
// the SAME node's own raw pruning fields re-checked, not another rule's
// `.warnings` output, so there's no cross-node ordering concern the way
// `parameterSensitivityEvidence.ts` had to work around).

import { isPruningPoor } from "./snowflakePruningDetail"
import { formatBytesCompact, formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many bytes, even poor pruning or material runtime isn't
 * worth a "large scan" finding — there's simply not much data involved. */
export const LARGE_BYTES_THRESHOLD = 1_073_741_824 // 1 GB

/** Above this many bytes, the finding escalates to `critical` regardless
 * of which other signal triggered it. */
export const HUGE_BYTES_THRESHOLD = 10_737_418_240 // 10 GB

/** Share of the query's total elapsed time (Snowflake's own per-operator
 * time unit) at or above which this node's own runtime is judged
 * material. */
export const MATERIAL_RUNTIME_PERCENTAGE_THRESHOLD = 10

export const largeScanVolume: Rule = (node) => {
  if (node.engine !== "snowflake") return []

  const bytesScanned = node.io?.bytesScanned
  if (bytesScanned === undefined || !Number.isFinite(bytesScanned) || bytesScanned < LARGE_BYTES_THRESHOLD) return []

  const overallPercentage = node.timeBreakdown?.overallPercentage
  const hasMaterialRuntime = overallPercentage !== undefined && Number.isFinite(overallPercentage) && overallPercentage >= MATERIAL_RUNTIME_PERCENTAGE_THRESHOLD
  const pruningPoor = isPruningPoor(node)
  if (!hasMaterialRuntime && !pruningPoor) return []

  const severity = bytesScanned >= HUGE_BYTES_THRESHOLD ? "critical" : "warning"
  const bytesText = formatBytesCompact(bytesScanned)
  const rowsText = node.actualRows !== undefined ? formatNumber(node.actualRows) : undefined

  const evidenceParts: string[] = []
  if (hasMaterialRuntime) evidenceParts.push(`took about ${overallPercentage!.toFixed(1)}% of the query's total time`)
  if (pruningPoor) evidenceParts.push("partition pruning barely narrowed this scan down (see the separate pruning finding on this same node, if present)")

  return [
    {
      ruleId: "large-scan-volume",
      severity,
      shortText: `Scanned ${bytesText}${rowsText ? ` to return ${rowsText} rows` : ""} — ${evidenceParts[0] ?? "material evidence beyond size alone"}.`,
      longText:
        `This ${node.rawOperatorLabel} scanned ${bytesText} of data${rowsText ? `, returning ${rowsText} rows` : ""}. ` +
        `A large byte count alone isn't automatically a problem — this app doesn't flag scan size in isolation. What ` +
        `makes this one worth noting: it ${evidenceParts.join(", and it ")}. Whether the fix is a more selective ` +
        `filter, better table clustering (see this app's own pruning finding when it fires on the same node), or ` +
        `this scan is simply doing necessary work, this plan alone can't say — but the combination of volume and ` +
        `real evidence (not size alone) is why this is surfaced.`,
      provenance: {
        threshold: `bytesScanned ≥ ${formatBytesCompact(LARGE_BYTES_THRESHOLD)} AND (runtime share ≥ ${MATERIAL_RUNTIME_PERCENTAGE_THRESHOLD}% OR poor pruning on this node)${severity === "critical" ? ` (critical at ≥ ${formatBytesCompact(HUGE_BYTES_THRESHOLD)})` : ""}`,
        computed: bytesText,
      },
    },
  ]
}
