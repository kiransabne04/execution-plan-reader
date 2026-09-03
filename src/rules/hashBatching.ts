// Episode 24, Story 24.4 — Hash node batching. `Batches > 1` means the
// hash table Postgres built didn't fit in the memory available for this
// operation (work_mem), so it processed the data in multiple batches
// instead of one pass — real, extra work (writing/reading batch data),
// distinct from — though often co-occurring with — the generic disk-spill
// signal `diskSpill.ts` already detects via `Disk Usage`. Kept as its OWN
// finding (this story's own instruction: "keep separate from generic
// spill when possible") because `Batches > 1` is itself informative even
// when `Disk Usage` isn't reported, and names the SPECIFIC mechanism
// (batching) rather than the generic "spilled to disk" wording.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many actual rows processed, multi-batch hashing on a small
 * hash table isn't worth flagging — Postgres can and does batch even
 * modest hash tables under some memory settings without it being a real
 * problem worth a reader's attention. */
export const MIN_ROWS_THRESHOLD = 1_000

export const hashBatching: Rule = (node) => {
  if (node.operatorType !== "hash") return []
  const batches = node.hash?.batches
  if (batches === undefined || batches <= 1) return []
  const rows = node.actualRows ?? node.estimatedRows
  if (rows === undefined || !Number.isFinite(rows) || rows < MIN_ROWS_THRESHOLD) return []

  const originalNote =
    node.hash?.originalBatches !== undefined && node.hash.originalBatches !== batches
      ? ` (originally planned for ${formatNumber(node.hash.originalBatches)})`
      : ""
  const memoryNote = node.hash?.peakMemoryKb !== undefined ? ` Peak memory usage was ${formatNumber(node.hash.peakMemoryKb)} kB.` : ""

  return [
    {
      ruleId: "hash-batching",
      severity: batches >= 8 ? "critical" : "warning",
      shortText: `Hash table processed in ${formatNumber(batches)} batches${originalNote} — didn't fit in the available memory.`,
      longText:
        `This Hash operation processed ${formatNumber(rows)} rows across ${formatNumber(batches)} batches${originalNote}. ` +
        `The hash table did not fit into the memory available for the operation and was processed in multiple batches — ` +
        `extra write/read work that a single in-memory pass wouldn't need.${memoryNote} A larger \`work_mem\` for this ` +
        `query, or reducing the volume feeding this Hash operation (a more selective filter earlier in the plan), are ` +
        `the usual fixes.`,
    },
  ]
}
