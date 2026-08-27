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
  actualTimePerExecutionMs?: PlanNode["actualTimePerExecutionMs"]
  predicate?: PlanNode["predicate"]
  index?: PlanNode["index"]
  join?: PlanNode["join"]
  io?: PlanNode["io"]
  spill?: PlanNode["spill"]
  parallel?: PlanNode["parallel"]
}

export function derivePostgresExtendedFields(
  attrs: Attributes,
  actualTimeMs: number | undefined,
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
  const io =
    bufferHits !== undefined || bufferReads !== undefined || ioReadTimeMs !== undefined || ioWriteTimeMs !== undefined
      ? { bufferHits, bufferReads, cacheHitRatio: computeCacheHitRatio(bufferHits, bufferReads), ioReadTimeMs, ioWriteTimeMs }
      : undefined

  const spill = deriveSpill(attrs)

  const workersLaunched = toNumber(attrs["Workers Launched"])
  const workersPlanned = toNumber(attrs["Workers Planned"])
  const parallel = workersLaunched !== undefined || workersPlanned !== undefined ? { workersLaunched, workersPlanned } : undefined

  const rowsRemovedByFilter = toNumber(attrs["Rows Removed by Filter"])

  // Postgres's Actual Total Time is already a per-loop-iteration average as
  // reported by the engine — there is no separate "cumulated" figure to
  // divide out here (see field catalog §7's correction). The two fields
  // are intentionally equal for Postgres.
  const actualTimePerExecutionMs = actualTimeMs

  return { rowsRemovedByFilter, actualTimePerExecutionMs, predicate, index, join, io, spill, parallel }
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
