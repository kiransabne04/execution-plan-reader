import type { PlanNode } from "../normalize"
import { buildTree } from "./buildTree"
import { parseRawRows } from "./rows"

export { parseRawRows, type OperatorRow, type ParsedRawInput } from "./rows"
export { buildTree } from "./buildTree"

export interface SnowflakeParseResult {
  root: PlanNode
  queryText?: string
  queryTextRedacted?: boolean
}

export function parseSnowflakeOperatorStats(rawInput: string): SnowflakeParseResult {
  const { rows, queryText, queryTextRedacted } = parseRawRows(rawInput)
  const root = buildTree(rows)
  return { root, queryText, queryTextRedacted }
}
