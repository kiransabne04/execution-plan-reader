// MVP rule 1: sequential/full scan on a LARGE table. Thresholded on table
// size, never on scan-type presence alone — a seq scan on a small table is
// often the correct, fastest plan, and a blanket "seq scan = bad" rule
// would reinforce a well-known beginner misconception instead of
// correcting it. See .claude/skills/rule-engine-authoring/SKILL.md.

import type { PlanNode } from "../parsers/normalize"
import { formatNumber } from "./format"
import type { Rule } from "./types"

export const LARGE_TABLE_ROW_THRESHOLD = 10_000

export const seqScanOnLargeTable: Rule = (node) => {
  if (node.operatorType !== "seq_scan") return []

  const rowCount = node.actualRows ?? node.estimatedRows
  if (rowCount === undefined || !Number.isFinite(rowCount) || rowCount <= LARGE_TABLE_ROW_THRESHOLD) {
    return []
  }

  const relation = pickRelationName(node)
  const rowsText = formatNumber(rowCount)
  const thresholdText = formatNumber(LARGE_TABLE_ROW_THRESHOLD)

  return [
    {
      ruleId: "seq-scan-on-large-table",
      severity: "warning",
      shortText: `Full scan of ${relation ?? "a large table"} (${rowsText} rows) — an index could avoid reading every row.`,
      longText:
        `This ${node.rawOperatorLabel} reads all ${rowsText} rows of ${relation ?? "this table"} ` +
        `without an index. On a table this size, a well-chosen index matching the query's filter/join ` +
        `columns usually reads far fewer rows. Small tables are a different story: below roughly ` +
        `${thresholdText} rows, a full scan is often the fastest plan available, which is why this only fires above that size.`,
    },
  ]
}

function pickRelationName(node: PlanNode): string | undefined {
  const raw = node.attributes["Relation Name"] ?? node.attributes["attr.table_name"] ?? node.attributes["Object.Table"]
  return raw !== undefined ? String(raw).replace(/^\[|\]$/g, "") : undefined
}
