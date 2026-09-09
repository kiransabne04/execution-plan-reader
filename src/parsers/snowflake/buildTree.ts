// Step 2 of 2: reconstruct a tree (really a DAG) from flat, ID-referenced
// operator rows. See .claude/skills/snowflake-plan-parsing/SKILL.md —
// WithClause/WithReference and similar CTE-related operators can have more
// than one entry in parentOperators. This is NOT a strict tree: a node with
// multiple parents is built ONCE and the same PlanNode object reference is
// attached under each of its parents' `children` arrays — linked, not
// duplicated, so no cost/row figure is ever double-counted by an aggregate
// rollup. Downstream (graph layer) is expected to render shared references
// distinctly rather than assume a strict single-parent tree.

import { normalizeJoinLogicalType, PlanParseError, type PlanNode } from "../normalize"
import { coerceRecord, getField, toAttributeValue, toFiniteNumber } from "./caseInsensitive"
import { mapSnowflakeOperatorType } from "./operatorMap"
import type { OperatorRow } from "./rows"

const EXECUTION_TIME_KEYS = [
  "overall_percentage",
  "initialization",
  "processing",
  "synchronization",
  "local_disk_io",
  "remote_disk_io",
  "network_communication",
] as const

export function buildTree(rows: OperatorRow[]): PlanNode {
  const nodesById = new Map<string, PlanNode>()
  for (const row of rows) {
    nodesById.set(row.id, makeNode(row))
  }

  // Second pass: wire up parent -> children edges now that every node
  // object exists. A node with multiple parents is pushed into each
  // parent's children array by reference (see module comment).
  for (const row of rows) {
    const node = nodesById.get(row.id)!
    for (const parentId of row.parentIds) {
      const parent = nodesById.get(parentId)
      if (!parent) continue // dangling reference — best-effort, don't crash
      parent.children.push(node)
    }
  }

  const roots = rows.filter((r) => r.parentIds.length === 0)
  if (roots.length === 0) {
    throw new PlanParseError("NOT_A_PLAN", "Every operator row references a parent — no root operator found.")
  }
  if (roots.length === 1) {
    return nodesById.get(roots[0].id)!
  }
  // More than one row claims no parent (unusual) — wrap under a synthetic
  // root rather than silently keeping only one and dropping the rest.
  return {
    id: "root",
    engine: "snowflake",
    operatorType: "unknown",
    rawOperatorLabel: "(multiple root operators)",
    role: "main",
    children: roots.map((r) => nodesById.get(r.id)!),
    attributes: {},
    warnings: [],
  }
}

function makeNode(row: OperatorRow): PlanNode {
  const operatorType = mapSnowflakeOperatorType(row.operation)
  const attributes: Record<string, string | number> = {}

  // Per-operator-type attribute schemas differ entirely (a Filter's
  // attributes bear no resemblance to a TableScan's) — flatten everything
  // generically so nothing is dropped just because a type isn't specially
  // handled; a small set of well-known fields get an additional promoted
  // form below for easy access.
  for (const [key, value] of Object.entries(row.attributes)) {
    attributes[`attr.${key}`] = toAttributeValue(value)
  }
  for (const [key, value] of Object.entries(row.statistics)) {
    attributes[`stat.${key}`] = toAttributeValue(value)
  }

  // Preserve the full execution-time breakdown individually — never
  // flattened into one aggregate number, since the rule engine needs each
  // component (e.g. to flag spill/IO-bound nodes specifically).
  if (row.executionTimeBreakdown) {
    for (const key of EXECUTION_TIME_KEYS) {
      if (key in row.executionTimeBreakdown) {
        attributes[`time.${key}`] = toAttributeValue(row.executionTimeBreakdown[key])
      }
    }
  }

  const spill = deriveSpill(row, attributes)
  const timeBreakdown = deriveTimeBreakdown(row)
  promoteRedactedQueryText(row, attributes)

  if (row.parentIds.length > 1) {
    attributes["Multi Parent"] = "true"
  }
  attributes["Parent Operator Ids"] = JSON.stringify(row.parentIds)

  const outputRows = toFiniteNumber(getField(row.statistics, "output_rows", "outputRows"))

  const filterText = toText(getField(row.attributes, "filter_condition", "condition"))
  const joinCondition = toText(
    getField(row.attributes, "equality_join_condition", "additional_join_condition"),
  )
  const predicate = filterText || joinCondition ? { filter: filterText, joinCondition } : undefined

  const logicalType = normalizeJoinLogicalType(toText(getField(row.attributes, "join_type")))
  const join = logicalType ? { logicalType } : undefined

  const io = deriveIo(row)
  const pruning = derivePruning(row)
  const network = deriveNetwork(row)
  const searchOptimization = deriveSearchOptimization(row)
  const dml = deriveDml(row)
  const stepId = toFiniteNumber(row.stepId)

  return {
    id: row.id,
    engine: "snowflake",
    operatorType,
    rawOperatorLabel: row.operation,
    // Snowflake's operator stats are post-execution only — there's no
    // pre-execution estimate to report, unlike Postgres/SQL Server.
    actualRows: outputRows,
    stepId,
    role: "main",
    predicate,
    join,
    io,
    spill,
    pruning,
    network,
    searchOptimization,
    dml,
    timeBreakdown,
    children: [],
    attributes,
    warnings: [],
  }
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Episode 33, Story 33.1 — fixed nesting bug: Snowflake's own
 * OPERATOR_STATISTICS carries spill data under a TOP-LEVEL `spilling`
 * object (a sibling of `io`/`pruning`), not nested inside `io` — and the
 * field names have no "_to_" in them (`bytes_spilled_local_storage`/
 * `bytes_spilled_remote_storage`, not `bytes_spilled_to_local_storage`/
 * `bytes_spilled_to_remote_storage`). Verified against Snowflake's own
 * GET_QUERY_OPERATOR_STATS function reference (docs.snowflake.com). The
 * prior version of this function read the wrong container AND the wrong
 * field names — a real plan's spill would have silently never been
 * detected at all. Promotes presence to an easily-checkable top-level
 * attribute (a first-class rule-engine signal) AND the normalized `spill`
 * sub-object, without removing the raw nested data preserved generically
 * above. */
function deriveSpill(row: OperatorRow, attributes: Record<string, string | number>): PlanNode["spill"] {
  const spilling = coerceRecord(getField(row.statistics, "spilling"))
  const local = toFiniteNumber(getField(spilling, "bytes_spilled_local_storage"))
  const remote = toFiniteNumber(getField(spilling, "bytes_spilled_remote_storage"))
  if (local !== undefined && local > 0) attributes["Spilled To Local Storage"] = local
  if (remote !== undefined && remote > 0) attributes["Spilled To Remote Storage"] = remote
  const occurred = (local !== undefined && local > 0) || (remote !== undefined && remote > 0)
  return occurred ? { occurred: true, bytesLocal: local, bytesRemote: remote } : undefined
}

/** Promotes the same executionTimeBreakdown data already flattened into
 * `attributes` (as `time.*`, above) into the normalized field the detail
 * panel actually reads — buildStatRows works off typed PlanNode fields, not
 * raw attribute keys, so without this promotion Snowflake nodes silently
 * never got a Time row in the panel at all (found re-verifying
 * docs/11-manual-testing-gaps-episode8.md's Gap 3 against Snowflake). */
function deriveTimeBreakdown(row: OperatorRow): PlanNode["timeBreakdown"] {
  const b = row.executionTimeBreakdown
  if (!b) return undefined
  const overallPercentage = toFiniteNumber(b.overall_percentage)
  const initializationPercentage = toFiniteNumber(b.initialization)
  const processingPercentage = toFiniteNumber(b.processing)
  const synchronizationPercentage = toFiniteNumber(b.synchronization)
  const localDiskIoPercentage = toFiniteNumber(b.local_disk_io)
  const remoteDiskIoPercentage = toFiniteNumber(b.remote_disk_io)
  const networkCommunicationPercentage = toFiniteNumber(b.network_communication)
  if (
    overallPercentage === undefined &&
    initializationPercentage === undefined &&
    processingPercentage === undefined &&
    synchronizationPercentage === undefined &&
    localDiskIoPercentage === undefined &&
    remoteDiskIoPercentage === undefined &&
    networkCommunicationPercentage === undefined
  ) {
    return undefined
  }
  return {
    overallPercentage,
    initializationPercentage,
    processingPercentage,
    synchronizationPercentage,
    localDiskIoPercentage,
    remoteDiskIoPercentage,
    networkCommunicationPercentage,
  }
}

/** Episode 33 — extended to capture the rest of the `io` object's real
 * fields (verified against Snowflake's own GET_QUERY_OPERATOR_STATS
 * function reference): `percentage_scanned_from_cache` (Story 33.3 —
 * corrects this app's own prior, now-disproven claim that this statistic
 * was unavailable outside `QUERY_HISTORY`; see `IoInfo.percentageScannedFromCache`'s
 * own doc comment), `external_bytes_scanned` (Story 33.5), and
 * `bytes_written_to_result`/`bytes_read_from_result` (Story 33.6). */
function deriveIo(row: OperatorRow): PlanNode["io"] {
  const io = coerceRecord(getField(row.statistics, "io"))
  const bytesScanned = toFiniteNumber(getField(io, "bytes_scanned"))
  const percentageScannedFromCache = toFiniteNumber(getField(io, "percentage_scanned_from_cache"))
  const externalBytesScanned = toFiniteNumber(getField(io, "external_bytes_scanned"))
  const bytesWrittenToResult = toFiniteNumber(getField(io, "bytes_written_to_result"))
  const bytesReadFromResult = toFiniteNumber(getField(io, "bytes_read_from_result"))
  if (
    bytesScanned === undefined &&
    percentageScannedFromCache === undefined &&
    externalBytesScanned === undefined &&
    bytesWrittenToResult === undefined &&
    bytesReadFromResult === undefined
  ) {
    return undefined
  }
  return { bytesScanned, percentageScannedFromCache, externalBytesScanned, bytesWrittenToResult, bytesReadFromResult }
}

/** Episode 33, Story 33.2 — fixed nesting AND field-name bug: pruning stats
 * live under a TOP-LEVEL `pruning` object in OPERATOR_STATISTICS (a
 * sibling of `io`/`spilling`), not under `attributes` — and the scanned-
 * count field is `partitions_scanned`, not `partitions_assigned` (which
 * doesn't exist in Snowflake's real schema at all). Verified against
 * Snowflake's own GET_QUERY_OPERATOR_STATS function reference. The prior
 * version of this function read a field that Snowflake's real output never
 * actually contains — `partitionsScanned` would have silently come back
 * `undefined` for every real Snowflake export, on every TableScan, ever.
 * Also now captures `partitions_pruned_by_snowflake_optima` (Story 33.7). */
function derivePruning(row: OperatorRow): PlanNode["pruning"] {
  const pruning = coerceRecord(getField(row.statistics, "pruning"))
  const partitionsScanned = toFiniteNumber(getField(pruning, "partitions_scanned"))
  const partitionsTotal = toFiniteNumber(getField(pruning, "partitions_total"))
  const partitionsPrunedByOptima = toFiniteNumber(getField(pruning, "partitions_pruned_by_snowflake_optima"))
  return partitionsScanned !== undefined || partitionsTotal !== undefined || partitionsPrunedByOptima !== undefined
    ? { partitionsScanned, partitionsTotal, partitionsPrunedByOptima }
    : undefined
}

/** Episode 33, Story 33.4 — Snowflake-specific, `network.network_bytes`, a
 * top-level sibling of `io`/`pruning`/`spilling` in OPERATOR_STATISTICS. */
function deriveNetwork(row: OperatorRow): PlanNode["network"] {
  const network = coerceRecord(getField(row.statistics, "network"))
  const bytesSent = toFiniteNumber(getField(network, "network_bytes"))
  return bytesSent !== undefined ? { bytesSent } : undefined
}

/** Episode 33, Story 33.7 — Snowflake-specific, the `search_optimization`
 * object. A genuinely different mechanism from Optima pruning (which lives
 * on `PruningInfo.partitionsPrunedByOptima` instead — see that field's own
 * doc comment for why they're kept separate). */
function deriveSearchOptimization(row: OperatorRow): PlanNode["searchOptimization"] {
  const so = coerceRecord(getField(row.statistics, "search_optimization"))
  const partitionsPrunedBySearchOptimization = toFiniteNumber(getField(so, "partitions_pruned_by_search_optimization"))
  const partitionsPrunedBySearchOptimizationAndOptima = toFiniteNumber(
    getField(so, "partitions_pruned_by_search_optimization_and_snowflake_optima"),
  )
  return partitionsPrunedBySearchOptimization !== undefined || partitionsPrunedBySearchOptimizationAndOptima !== undefined
    ? { partitionsPrunedBySearchOptimization, partitionsPrunedBySearchOptimizationAndOptima }
    : undefined
}

/** Episode 33, Story 33.9 — Snowflake-specific, the `dml` object. Present
 * only on DML operator nodes (Insert/Update/Delete/Merge/Unload — see
 * `operatorMap.ts`), never on a read-only scan/join/aggregate. */
function deriveDml(row: OperatorRow): PlanNode["dml"] {
  const dml = coerceRecord(getField(row.statistics, "dml"))
  const rowsInserted = toFiniteNumber(getField(dml, "number_of_rows_inserted"))
  const rowsUpdated = toFiniteNumber(getField(dml, "number_of_rows_updated"))
  const rowsDeleted = toFiniteNumber(getField(dml, "number_of_rows_deleted"))
  const rowsUnloaded = toFiniteNumber(getField(dml, "number_of_rows_unloaded"))
  return rowsInserted !== undefined || rowsUpdated !== undefined || rowsDeleted !== undefined || rowsUnloaded !== undefined
    ? { rowsInserted, rowsUpdated, rowsDeleted, rowsUnloaded }
    : undefined
}

/** Organizations with query-text redaction enabled show `<redacted>` for
 * non-owning users. Never treat that literal token as real query content —
 * flag it clearly instead. */
function promoteRedactedQueryText(row: OperatorRow, attributes: Record<string, string | number>): void {
  const qt = getField(row.attributes, "sql_text", "query_text", "queryText")
  if (typeof qt === "string" && qt === "<redacted>") {
    attributes["Query Text"] = "query text redacted by account policy"
    attributes["Query Text Redacted"] = "true"
  }
}
