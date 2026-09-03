// Episode 24, Story 24.12 — materially significant WAL generation
// (`EXPLAIN (ANALYZE, WAL)`), per the specific write operator that
// generated it. Kept observational (this story's own explicit
// instruction) — WAL volume is inherent to write-heavy operations; this
// rule states the volume, not a verdict, since whether it's a problem
// depends on context (replication lag tolerance, WAL archiving/network
// bandwidth) this app has no visibility into from a single pasted plan.

import { formatNumber, formatBytesCompact } from "./format"
import type { Rule } from "./types"

export const MATERIAL_WAL_BYTES_THRESHOLD = 1_048_576 // 1 MB

export const walVolume: Rule = (node) => {
  const bytes = node.wal?.bytes
  if (bytes === undefined || bytes < MATERIAL_WAL_BYTES_THRESHOLD) return []

  const sizeText = formatBytesCompact(bytes)
  const recordsNote = node.wal?.records !== undefined ? ` across ${formatNumber(node.wal.records)} WAL records` : ""
  const fpiNote = node.wal?.fpi !== undefined && node.wal.fpi > 0 ? ` (${formatNumber(node.wal.fpi)} full-page images included)` : ""

  return [
    {
      ruleId: "wal-volume",
      severity: "info",
      shortText: `Generated ${sizeText} of WAL${recordsNote}.`,
      longText:
        `This ${node.rawOperatorLabel} operation generated ${sizeText} of write-ahead log data${recordsNote}${fpiNote}. ` +
        `This is a plain observation, not a verdict — WAL volume is inherent to write-heavy operations, and whether ` +
        `this amount matters depends on context this app can't see from one pasted plan (replication lag tolerance, WAL ` +
        `archiving bandwidth, checkpoint frequency). Worth noting if this operation runs frequently and WAL volume is a ` +
        `known concern for this system.`,
    },
  ]
}
