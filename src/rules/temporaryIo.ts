// Episode 24, Story 24.6 — materially high temp-file I/O (`Temp Read/
// Written Blocks`, `BUFFERS` option). Postgres's block size is a fixed
// 8 kB, so block counts convert directly to bytes. Temp files are what a
// Sort/Hash operator that spilled actually reads/writes — this rule
// relates itself to those existing findings (`sortDiskSpill.ts`,
// `hashBatching.ts`, the generic `diskSpill.ts`) on the SAME node rather
// than presenting temp I/O as an unrelated mystery, per this story's own
// instruction ("relate it... rather than duplicating them blindly") — but
// still fires as its own finding, since the raw I/O VOLUME is itself a
// useful, concrete number those other findings don't surface directly.

import { formatBytesCompact } from "./format"
import type { Rule } from "./types"

const POSTGRES_BLOCK_SIZE_BYTES = 8_192

/** Below this many total blocks (read + written), temp I/O is too small
 * to be materially worth its own finding. */
export const MATERIAL_BLOCK_THRESHOLD = 1_000

export const temporaryIo: Rule = (node) => {
  const readBlocks = node.io?.tempReadBlocks ?? 0
  const writtenBlocks = node.io?.tempWrittenBlocks ?? 0
  const totalBlocks = readBlocks + writtenBlocks
  if (totalBlocks < MATERIAL_BLOCK_THRESHOLD) return []

  const totalBytes = totalBlocks * POSTGRES_BLOCK_SIZE_BYTES
  const sizeText = formatBytesCompact(totalBytes)

  const relatedToSort = node.sort?.spaceType === "disk"
  const relatedToHash = (node.hash?.batches ?? 1) > 1
  const relationNote = relatedToSort
    ? " This matches the disk-based sort already noted on this same operator — the temp file activity IS that spill."
    : relatedToHash
      ? " This matches the multi-batch hash processing already noted on this same operator — the temp file activity IS that batching."
      : ""

  return [
    {
      ruleId: "temp-io",
      severity: totalBytes >= 100 * 1024 * 1024 ? "critical" : "warning",
      shortText: `${sizeText} of temp-file I/O on this operator.`,
      longText:
        `This ${node.rawOperatorLabel} operation read/wrote ${sizeText} of temp files (${readBlocks.toLocaleString("en-US")} blocks ` +
        `read, ${writtenBlocks.toLocaleString("en-US")} blocks written, at Postgres's fixed 8 kB block size).${relationNote} ` +
        `Temp file I/O happens when a sort or hash operation doesn't fit in the memory it was given — increasing ` +
        `\`work_mem\` for this query is the usual fix.`,
    },
  ]
}
