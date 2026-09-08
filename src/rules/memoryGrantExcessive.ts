// SQL Server rule: memory-grant-excessive. `MemoryGrantInfo` (parsed in
// `parseShowplanXml.ts`, root-node-only — one grant covers a query's
// memory-consuming operators collectively) reports both what SQL Server
// GRANTED and the peak the query actually USED. A grant far larger than
// what got used isn't free: the memory was reserved for this query for its
// whole duration, unavailable to every other concurrently-running query on
// the instance, whether or not this one query itself ran fine.
//
// Story's own worked example: Granted 1GB, Max used 70MB — a ~15x ratio on
// a genuinely large absolute amount of wasted memory (≈954MB). Both a
// ratio floor AND an absolute floor are required together (this file's own
// explicit instruction) — the same "every factor together" shape used
// throughout this codebase's other materiality-graded rules, so a small
// query with a tiny, technically-oversized grant (say, 2MB granted, 200KB
// used — a 10x ratio on a trivial amount) doesn't fire just because the
// ratio alone cleared a threshold.

import { formatBytesCompact } from "./format"
import type { Rule } from "./types"

/** Ratio of granted-to-used memory at or above which the grant is judged
 * oversized. */
export const EXCESSIVE_RATIO_THRESHOLD = 4

/** Above this ratio, the finding escalates to `critical`. */
export const LARGE_EXCESSIVE_RATIO_THRESHOLD = 10

/** Below this many KB of WASTED memory (granted minus used), even a huge
 * ratio isn't material — the absolute floor this file's own instruction
 * requires alongside the ratio. 51,200 KB = 50 MB. */
export const MIN_WASTED_KB_THRESHOLD = 51_200

export const memoryGrantExcessive: Rule = (node, context) => {
  if (node.engine !== "sqlserver" || node.id !== context.rootId) return [] // whole-query fact, surfaced once — same pattern as parameterSensitivityNote.ts

  const grantedKb = node.memoryGrant?.grantedKb
  const maxUsedKb = node.memoryGrant?.maxUsedKb
  if (grantedKb === undefined || !Number.isFinite(grantedKb) || grantedKb <= 0) return []
  if (maxUsedKb === undefined || !Number.isFinite(maxUsedKb) || maxUsedKb < 0) return []

  const wastedKb = grantedKb - maxUsedKb
  if (wastedKb < MIN_WASTED_KB_THRESHOLD) return []

  // maxUsedKb === 0 is a genuine, real "used essentially nothing" case —
  // avoid a divide-by-zero producing Infinity in the ratio text while
  // still treating it as maximally excessive.
  const ratio = maxUsedKb > 0 ? grantedKb / maxUsedKb : Number.POSITIVE_INFINITY
  if (ratio < EXCESSIVE_RATIO_THRESHOLD) return []

  const severity = ratio >= LARGE_EXCESSIVE_RATIO_THRESHOLD ? "critical" : "warning"
  const grantedText = formatBytesCompact(grantedKb * 1024)
  const usedText = formatBytesCompact(maxUsedKb * 1024)
  const wastedText = formatBytesCompact(wastedKb * 1024)
  const ratioText = Number.isFinite(ratio) ? `${ratio.toFixed(1)}x` : "far more than"

  return [
    {
      ruleId: "memory-grant-excessive",
      severity,
      shortText: `Memory grant of ${grantedText} but only ${usedText} was ever used (${ratioText} more than needed).`,
      longText:
        `SQL Server granted this query ${grantedText} of memory, but the peak actually used was only ${usedText} — ` +
        `${ratioText} more was reserved than the query ever needed, wasting about ${wastedText}. This doesn't slow ` +
        `this query down by itself — the impact is on CONCURRENCY: that memory was reserved and unavailable to every ` +
        `other query running on the instance for as long as this one held it, even though most of it went unused. A ` +
        `large, over-estimated grant can even make other concurrent queries wait for memory (RESOURCE_SEMAPHORE ` +
        `waits) that this query itself didn't need. Stale statistics, a cardinality estimate that came in far above ` +
        `the real row count, or a parameter-sensitive plan compiled for an unusually large input are the usual ` +
        `causes — none confirmed from this plan alone.`,
      provenance: {
        threshold: `granted/maxUsed ratio ≥ ${EXCESSIVE_RATIO_THRESHOLD} AND wasted ≥ ${formatBytesCompact(MIN_WASTED_KB_THRESHOLD * 1024)}${severity === "critical" ? ` (critical at ratio ≥ ${LARGE_EXCESSIVE_RATIO_THRESHOLD})` : ""}`,
        computed: `${ratioText} (${grantedText} granted, ${usedText} used)`,
      },
    },
  ]
}
