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

function parseRow(raw: unknown, index: number): OperatorRow {
  if (!isRecord(raw)) {
    throw new PlanParseError("NOT_A_PLAN", `Row ${index} isn't a recognizable operator object.`)
  }

  const id = getField(raw, "id", "operator_id", "operatorId")
  const operation = getField(raw, "operation", "operator_type", "operatorType")
  if (id === undefined || operation === undefined) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      `Row ${index} is missing an operator id/type — this doesn't look like Snowflake operator-stats JSON.`,
    )
  }

  const parentIds = coerceIdList(getField(raw, "parentOperators", "parent_operators", "parent", "parentOperator"))
  const attributes = coerceRecord(getField(raw, "attributes", "operator_attributes", "operatorAttributes"))
  const statistics = coerceRecord(getField(raw, "statistics", "operator_statistics", "operatorStatistics"))
  const timeBreakdownRaw = getField(raw, "executionTimeBreakdown", "execution_time_breakdown")
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
