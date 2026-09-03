// Derives the promoted, normalized sub-fields (predicate/index/join/io/
// spill/parallel/rowsRemovedByFilter/actualTimePerExecutionMs) from a
// node's already-collected raw attributes bag. Shared between the JSON and
// TEXT parsers since both produce attribute keys with the same names by
// design (that's what the parity tests between them assert) — see
// docs/10-node-stats-field-catalog.md, the authoritative source for every
// mapping below.

import { computeCacheHitRatio, normalizeJoinLogicalType, type PlanNode } from "../normalize"

type Attributes = Record<string, string | number>

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function toText(value: string | number | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export interface ExtendedFields {
  rowsRemovedByFilter?: PlanNode["rowsRemovedByFilter"]
  rowsRemovedByJoinFilter?: PlanNode["rowsRemovedByJoinFilter"]
  heapFetches?: PlanNode["heapFetches"]
  actualTimePerExecutionMs?: PlanNode["actualTimePerExecutionMs"]
  predicate?: PlanNode["predicate"]
  index?: PlanNode["index"]
  join?: PlanNode["join"]
  io?: PlanNode["io"]
  spill?: PlanNode["spill"]
  pruning?: PlanNode["pruning"]
  parallel?: PlanNode["parallel"]
  sort?: PlanNode["sort"]
  hash?: PlanNode["hash"]
  memoize?: PlanNode["memoize"]
  wal?: PlanNode["wal"]
}

/** `operatorType` (Episode 24) disambiguates the one real per-node key
 * collision in this file: Hash and Memoize nodes both report their own
 * "Peak Memory Usage" under the exact same JSON/TEXT key name — routing by
 * type is the only way to know which sub-object it belongs on, not
 * guessable from the key alone. */
export function derivePostgresExtendedFields(
  attrs: Attributes,
  actualTimeMs: number | undefined,
  operatorType?: string,
): ExtendedFields {
  const filter = toText(attrs["Filter"])
  const indexCondition = toText(attrs["Index Cond"])
  const joinCondition = toText(attrs["Hash Cond"]) ?? toText(attrs["Merge Cond"])
  const predicate =
    filter || indexCondition || joinCondition ? { filter, indexCondition, joinCondition } : undefined

  const indexName = toText(attrs["Index Name"])
  const scanDirection = toText(attrs["Scan Direction"])
  // Postgres doesn't reliably restate the underlying access method (btree/
  // gin/gist/hash) on the plan node itself — an honest gap, not guessed
  // from Node Type (field catalog §2).
  const index = indexName || scanDirection ? { name: indexName, scanDirection } : undefined

  const logicalType = normalizeJoinLogicalType(toText(attrs["Join Type"]))
  const join = logicalType ? { logicalType } : undefined

  const bufferHits = sumDefined(toNumber(attrs["Shared Hit Blocks"]), toNumber(attrs["Local Hit Blocks"]))
  const bufferReads = sumDefined(toNumber(attrs["Shared Read Blocks"]), toNumber(attrs["Local Read Blocks"]))
  const ioReadTimeMs = toNumber(attrs["I/O Read Time"])
  const ioWriteTimeMs = toNumber(attrs["I/O Write Time"])
  // Episode 24, Story 24.6 — temp-file I/O (a sort/hash spill), a distinct
  // concern from the shared-buffer-cache figures above.
  const tempReadBlocks = toNumber(attrs["Temp Read Blocks"])
  const tempWrittenBlocks = toNumber(attrs["Temp Written Blocks"])
  const io =
    bufferHits !== undefined ||
    bufferReads !== undefined ||
    ioReadTimeMs !== undefined ||
    ioWriteTimeMs !== undefined ||
    tempReadBlocks !== undefined ||
    tempWrittenBlocks !== undefined
      ? { bufferHits, bufferReads, cacheHitRatio: computeCacheHitRatio(bufferHits, bufferReads), ioReadTimeMs, ioWriteTimeMs, tempReadBlocks, tempWrittenBlocks }
      : undefined

  const spill = deriveSpill(attrs)

  const workersLaunched = toNumber(attrs["Workers Launched"])
  const workersPlanned = toNumber(attrs["Workers Planned"])
  const parallel = workersLaunched !== undefined || workersPlanned !== undefined ? { workersLaunched, workersPlanned } : undefined

  const rowsRemovedByFilter = toNumber(attrs["Rows Removed by Filter"])
  const rowsRemovedByJoinFilter = toNumber(attrs["Rows Removed by Join Filter"])
  const heapFetches = toNumber(attrs["Heap Fetches"])

  // Episode 24, Story 24.5 — Sort nodes only; `Sort Space Used`/`Sort Space
  // Type` are populated together with `Sort Method` in real Postgres
  // output, so presence of the method alone is enough to gate the whole
  // sub-object.
  const sortMethod = toText(attrs["Sort Method"])
  const sortSpaceUsedKb = toNumber(attrs["Sort Space Used"])
  const sortSpaceTypeRaw = toText(attrs["Sort Space Type"])
  const sort =
    sortMethod !== undefined || sortSpaceUsedKb !== undefined
      ? { method: sortMethod, spaceUsedKb: sortSpaceUsedKb, spaceType: sortSpaceTypeRaw === "Disk" ? ("disk" as const) : sortSpaceTypeRaw === "Memory" ? ("memory" as const) : undefined }
      : undefined

  // Episode 24, Story 24.4 — Hash nodes only.
  const hashBuckets = toNumber(attrs["Hash Buckets"])
  const hashBatches = toNumber(attrs["Hash Batches"])
  const originalHashBatches = toNumber(attrs["Original Hash Batches"])
  // "Peak Memory Usage" is shared with Memoize (below) — only attributed to
  // Hash when this node genuinely IS one (see this function's own doc
  // comment on why `operatorType` is a parameter at all).
  const hashPeakMemoryKb = operatorType === "hash" ? toNumber(attrs["Peak Memory Usage"]) : undefined
  const hash =
    hashBuckets !== undefined || hashBatches !== undefined || originalHashBatches !== undefined || hashPeakMemoryKb !== undefined
      ? { buckets: hashBuckets, batches: hashBatches, originalBatches: originalHashBatches, peakMemoryKb: hashPeakMemoryKb }
      : undefined

  // Episode 24, Story 24.10 — Memoize nodes only.
  const cacheHits = toNumber(attrs["Cache Hits"])
  const cacheMisses = toNumber(attrs["Cache Misses"])
  const cacheEvictions = toNumber(attrs["Cache Evictions"])
  const cacheOverflows = toNumber(attrs["Cache Overflows"])
  const memoizePeakMemoryKb = operatorType === "memoize" ? toNumber(attrs["Peak Memory Usage"]) : undefined
  const memoize =
    cacheHits !== undefined || cacheMisses !== undefined || cacheEvictions !== undefined || cacheOverflows !== undefined || memoizePeakMemoryKb !== undefined
      ? { cacheHits, cacheMisses, cacheEvictions, cacheOverflows, peakMemoryKb: memoizePeakMemoryKb }
      : undefined

  // Episode 24, Story 24.12 — per-node, whichever write operator generated it.
  const walRecords = toNumber(attrs["WAL Records"])
  const walFpi = toNumber(attrs["WAL FPI"])
  const walBytes = toNumber(attrs["WAL Bytes"])
  const wal = walRecords !== undefined || walFpi !== undefined || walBytes !== undefined ? { records: walRecords, fpi: walFpi, bytes: walBytes } : undefined

  // Episode 24, Story 24.11 — Append/MergeAppend runtime partition pruning.
  const subplansRemoved = toNumber(attrs["Subplans Removed"])
  const pruning = subplansRemoved !== undefined ? { subplansRemoved } : undefined

  // Postgres's Actual Total Time is already a per-loop-iteration average as
  // reported by the engine — there is no separate "cumulated" figure to
  // divide out here (see field catalog §7's correction). The two fields
  // are intentionally equal for Postgres.
  const actualTimePerExecutionMs = actualTimeMs

  return {
    rowsRemovedByFilter,
    rowsRemovedByJoinFilter,
    heapFetches,
    actualTimePerExecutionMs,
    predicate,
    index,
    join,
    io,
    spill,
    pruning,
    parallel,
    sort,
    hash,
    memoize,
    wal,
  }
}

function deriveSpill(attrs: Attributes): PlanNode["spill"] {
  if (attrs["Sort Space Type"] === "Disk") {
    const kb = toNumber(attrs["Sort Space Used"])
    return { occurred: true, bytesLocal: kb !== undefined ? kb * 1024 : undefined, detail: "external sort" }
  }
  const diskUsageKb = toNumber(attrs["Disk Usage"])
  if (diskUsageKb !== undefined && diskUsageKb > 0) {
    return { occurred: true, bytesLocal: diskUsageKb * 1024, detail: "hash spill" }
  }
  return undefined
}

function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}
