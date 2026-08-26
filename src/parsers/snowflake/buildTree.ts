// Step 2 of 2: reconstruct a tree (really a DAG) from flat, ID-referenced
// operator rows. See .claude/skills/snowflake-plan-parsing/SKILL.md —
// WithClause/WithReference and similar CTE-related operators can have more
// than one entry in parentOperators. This is NOT a strict tree: a node with
// multiple parents is built ONCE and the same PlanNode object reference is
// attached under each of its parents' `children` arrays — linked, not
// duplicated, so no cost/row figure is ever double-counted by an aggregate
// rollup. Downstream (graph layer) is expected to render shared references
// distinctly rather than assume a strict single-parent tree.

import { PlanParseError, type PlanNode } from "../normalize"
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

  promoteSpill(row, attributes)
  promoteRedactedQueryText(row, attributes)

  if (row.parentIds.length > 1) {
    attributes["Multi Parent"] = "true"
  }
  attributes["Parent Operator Ids"] = JSON.stringify(row.parentIds)

  const outputRows = toFiniteNumber(getField(row.statistics, "output_rows", "outputRows"))

  return {
    id: row.id,
    engine: "snowflake",
    operatorType,
    rawOperatorLabel: row.operation,
    // Snowflake's operator stats are post-execution only — there's no
    // pre-execution estimate to report, unlike Postgres/SQL Server.
    actualRows: outputRows,
    role: "main",
    children: [],
    attributes,
    warnings: [],
  }
}

/** Spill is nested inside an IO detail object and easy to overlook — promote
 * its presence to an easily-checkable top-level attribute (a first-class
 * rule-engine signal), without removing the raw nested data above. */
function promoteSpill(row: OperatorRow, attributes: Record<string, string | number>): void {
  const io = coerceRecord(getField(row.statistics, "io"))
  const local = toFiniteNumber(getField(io, "bytes_spilled_to_local_storage"))
  const remote = toFiniteNumber(getField(io, "bytes_spilled_to_remote_storage"))
  if (local !== undefined && local > 0) attributes["Spilled To Local Storage"] = local
  if (remote !== undefined && remote > 0) attributes["Spilled To Remote Storage"] = remote
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
