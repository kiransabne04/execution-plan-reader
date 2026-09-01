// Step 1 of 2 (see .claude/skills/snowflake-plan-parsing/SKILL.md): parse
// raw input into a flat list of operator rows. Tree reconstruction is a
// deliberately separate step (buildTree.ts) — Snowflake's output is not a
// tree, it's a flat list with ID-based parent references, and conflating
// "parse the JSON" with "build the tree" makes both harder to test.

import { PlanParseError } from "../normalize"
import { coerceRecord, getField, isRecord } from "./caseInsensitive"

export interface OperatorRow {
  id: string
  operation: string
  parentIds: string[]
  attributes: Record<string, unknown>
  statistics: Record<string, unknown>
  executionTimeBreakdown: Record<string, unknown> | undefined
}

export interface ParsedRawInput {
  rows: OperatorRow[]
  queryText?: string
  queryTextRedacted?: boolean
}

const ROW_LIST_KEYS = ["operators", "data", "rows", "result", "operatorStats"]

/** A copy-pasted result grid often stringifies array/variant columns
 * (`"[3, 8]"` or `"3,8"` instead of a real JSON array) — tolerate both, and
 * a bare scalar under the singular `parent` key too. */
function coerceIdList(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (typeof value === "number") return [String(value)]
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return []
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map((v) => String(v))
      } catch {
        // not valid JSON — fall through to comma-split below
      }
    }
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

export function parseRawRows(rawInput: string): ParsedRawInput {
  const cleaned = rawInput.trim()
  if (cleaned.length === 0) {
    throw new PlanParseError("EMPTY_INPUT", "Input is empty")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like Snowflake operator-stats JSON. Paste the JSON result of " +
        "SELECT * FROM TABLE(GET_QUERY_OPERATOR_STATS('<query_id>')).",
    )
  }

  let rawRows: unknown[]
  let queryText: string | undefined
  let queryTextRedacted: boolean | undefined

  if (Array.isArray(parsed)) {
    rawRows = parsed
  } else if (isRecord(parsed)) {
    const listField = ROW_LIST_KEYS.map((key) => getField(parsed, key)).find((v) => Array.isArray(v))
    if (!Array.isArray(listField)) {
      throw new PlanParseError(
        "NOT_A_PLAN",
        "This doesn't look like Snowflake operator-stats JSON (no array of operator rows found).",
      )
    }
    rawRows = listField
    const qt = getField(parsed, "queryText", "query_text")
    if (typeof qt === "string") {
      queryText = qt
      queryTextRedacted = qt === "<redacted>"
    }
  } else {
    throw new PlanParseError("NOT_A_PLAN", "This doesn't look like Snowflake operator-stats JSON.")
  }

  if (rawRows.length === 0) {
    throw new PlanParseError(
      "EMPTY_RESULT",
      "No operator rows found — the query ID may be incorrect, or results may not be available yet.",
    )
  }

  const rows = rawRows.map((raw, index) => parseRow(raw, index))
  return { rows, queryText, queryTextRedacted }
}

// Every alias this parser claims for a structural field, kept as one list
// so the row-level statistics fallback below (which treats "everything not
// already claimed" as ad hoc statistics) can never accidentally re-absorb
// a field that's already been read as the id, operation, parent link,
// attributes bag, or time breakdown.
const ID_ALIASES = ["id", "operator_id", "operatorId"]
const OPERATION_ALIASES = ["operation", "operator_type", "operatorType"]
const PARENT_ALIASES = [
  "parentOperators",
  "parent_operators",
  "parent",
  "parentOperator",
  // A near-miss export that gives each row exactly ONE parent (a scalar
  // id, not an array) rather than Snowflake's own plural/array
  // PARENT_OPERATORS column — coerceIdList below already handles a bare
  // scalar under any of these keys the same way it handles a real array.
  "parentOperatorId",
  "parent_operator_id",
]
const ATTRIBUTE_ALIASES = ["attributes", "operator_attributes", "operatorAttributes"]
const STATISTICS_ALIASES = ["statistics", "operator_statistics", "operatorStatistics"]
const TIME_BREAKDOWN_ALIASES = ["executionTimeBreakdown", "execution_time_breakdown"]

function parseRow(raw: unknown, index: number): OperatorRow {
  if (!isRecord(raw)) {
    throw new PlanParseError("NOT_A_PLAN", `Row ${index} isn't a recognizable operator object.`)
  }

  const id = getField(raw, ...ID_ALIASES)
  const operation = getField(raw, ...OPERATION_ALIASES)
  if (id === undefined || operation === undefined) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      `Row ${index} is missing an operator id/type — this doesn't look like Snowflake operator-stats JSON.`,
    )
  }

  const parentIds = coerceIdList(getField(raw, ...PARENT_ALIASES))
  const attributes = coerceRecord(getField(raw, ...ATTRIBUTE_ALIASES))
  let statistics = coerceRecord(getField(raw, ...STATISTICS_ALIASES))
  if (Object.keys(statistics).length === 0) {
    // Near-miss shape: this export has no separate statistics container at
    // all — row/time figures (e.g. `outputRows`, `executionTimeMs`) sit as
    // plain sibling fields on the row itself instead of nested under
    // `statistics`/`operator_statistics`/`operatorStatistics`. Rather than
    // silently losing every row/time figure because of that, fall back to
    // treating whatever the row has left over — once id/operation/parent/
    // attributes/time-breakdown are excluded — as its statistics. This is
    // deliberately generic (no guessing of a specific field name here):
    // buildTree.ts's own `getField(row.statistics, "output_rows",
    // "outputRows", ...)` lookups already do the actual field-name
    // tolerance, this just gives them a container to look inside.
    const claimed = new Set(
      [...ID_ALIASES, ...OPERATION_ALIASES, ...PARENT_ALIASES, ...ATTRIBUTE_ALIASES, ...STATISTICS_ALIASES, ...TIME_BREAKDOWN_ALIASES].map(
        (k) => k.toLowerCase(),
      ),
    )
    statistics = Object.fromEntries(Object.entries(raw).filter(([key]) => !claimed.has(key.toLowerCase())))
  }
  const timeBreakdownRaw = getField(raw, ...TIME_BREAKDOWN_ALIASES)
  const executionTimeBreakdown = timeBreakdownRaw !== undefined ? coerceRecord(timeBreakdownRaw) : undefined

  return {
    id: String(id),
    operation: String(operation),
    parentIds,
    attributes,
    statistics,
    executionTimeBreakdown,
  }
}
