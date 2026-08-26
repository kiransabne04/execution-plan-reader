// MVP rule 6: missing/unused index opportunity, where derivable from
// available data. SQL Server's Showplan XML frequently embeds the
// optimizer's own MissingIndexGroup recommendations — that's real,
// engine-provided data, surfaced here rather than an invented heuristic.
// Postgres/Snowflake EXPLAIN output carries no equivalent recommendation
// data, so this rule simply doesn't fire for those engines — a shakier
// inferred heuristic risks the false positives the rule-engine-authoring
// skill warns erode trust as much as missed detections.

import type { Rule } from "./types"

export const missingIndexOpportunity: Rule = (node, context) => {
  if (node.id !== context.rootId) return [] // whole-statement signal, surfaced once
  if (!context.missingIndexes || context.missingIndexes.length === 0) return []

  return context.missingIndexes.map((rec, index) => {
    const columns = [...rec.equalityColumns, ...rec.inequalityColumns]
    const columnsText = columns.length > 0 ? columns.join(", ") : "the filtered/joined columns"
    const impactText =
      rec.impact !== undefined && Number.isFinite(rec.impact) ? ` (estimated ${rec.impact.toFixed(1)}% impact)` : ""
    const includedText = rec.includedColumns.length > 0 ? ` with ${rec.includedColumns.join(", ")} included` : ""

    return {
      ruleId: `missing-index-opportunity-${index}`,
      severity: "info" as const,
      shortText: `Missing index suggested on ${rec.table ?? "a table"} (${columnsText})${impactText}.`,
      longText:
        `SQL Server's optimizer flagged that an index on ${rec.table ?? "this table"} covering ${columnsText}` +
        `${includedText} could reduce the cost of this query${impactText}. This is the engine's own recommendation, ` +
        `not a guess — verify it against your actual workload before creating it, since a single query's benefit ` +
        `doesn't account for write overhead on other queries that touch the same table.`,
    }
  })
}
