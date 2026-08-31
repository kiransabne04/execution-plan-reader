// Orchestrates the whole rule-based-path flow for one pasted plan: detect
// which engine/format it is, parse it, run the rule engine, and summarize
// it. Kept separate from the React component so it's a pure, independently
// testable function — the component's only job is displaying whatever this
// returns (or the error it throws).

import { PlanParseError, type PlanNode } from "../parsers/normalize"
import { parsePostgresJsonPlan } from "../parsers/postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../parsers/postgres/textParser"
import { parseSqlServerShowplanXml, type MissingIndexRecommendation } from "../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../parsers/snowflake"
import { applyRules } from "../rules/index"
import { buildPlanContext, type MissingIndexSignal, type PlanContext } from "../rules/types"
import { summarizePlan, type PlanSummary } from "../rules/summarize"

export type DetectedEngine = "postgres" | "sqlserver" | "snowflake"

export interface AnalyzedStatement {
  label: string
  root: PlanNode
  summary: PlanSummary
  /** The exact context the rule engine ran with — passed to the graph/panel
   * layer too, so contribution-%/query-correlation see the same statement
   * text and totals the rules themselves used. */
  context: PlanContext
}

export interface AnalyzedPlan {
  engine: DetectedEngine
  statements: AnalyzedStatement[]
  /** Snowflake-only: the account has query-text redaction enabled. */
  queryTextRedacted?: boolean
}

function toMissingIndexSignals(recs: MissingIndexRecommendation[]): MissingIndexSignal[] {
  return recs.map((rec) => ({
    impact: rec.impact,
    table: rec.table,
    equalityColumns: rec.equalityColumns,
    inequalityColumns: rec.inequalityColumns,
    includedColumns: rec.includedColumns,
  }))
}

// Story 20.1 — SQL Server's showplan XML attributes a statement's leading
// `--` comment lines (developer commentary, TFS/ticket references) to the
// FOLLOWING statement's own `StatementText`, not the comment's own
// (nonexistent) statement. Left alone, a tab label ends up being a stale
// code comment instead of the actual SQL. Strips only LEADING comment
// lines — a comment appearing after real SQL has started is left as-is,
// since at that point it's legitimately part of what the label is
// summarizing (e.g. an inline trailing comment on the same statement).
function stripLeadingComments(text: string): string {
  const lines = text.split("\n")
  let i = 0
  while (i < lines.length && (lines[i].trim() === "" || lines[i].trim().startsWith("--"))) i++
  return lines.slice(i).join("\n")
}

function truncateLabel(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function analyzeRoot(
  root: PlanNode,
  label: string,
  extra?: { statementText?: string; missingIndexes?: MissingIndexSignal[]; queryTextRedacted?: boolean },
): AnalyzedStatement {
  const context = buildPlanContext(root, extra)
  applyRules(root, context)
  return { label, root, summary: summarizePlan(root), context }
}

/**
 * Detects the format from the pasted text's own shape (XML tag, JSON
 * bracket, or plain text) and routes to the matching parser(s). For
 * JSON-shaped input, Postgres is tried first (its "Plan"/"Node Type" shape
 * is distinctive) before falling back to Snowflake — both are legitimate
 * JSON formats this tool accepts, so a NOT_A_PLAN from one just means "try
 * the other," not a hard failure.
 */
export function analyzePlanText(raw: string): AnalyzedPlan {
  const trimmed = raw.trim()

  if (trimmed.startsWith("<")) {
    const { statements } = parseSqlServerShowplanXml(raw)
    return {
      engine: "sqlserver",
      statements: statements.map((stmt, i) => {
        const withoutLeadingComments = stmt.statementText ? stripLeadingComments(stmt.statementText) : ""
        const label = withoutLeadingComments.trim() ? truncateLabel(withoutLeadingComments) : `Statement ${i + 1}`
        return analyzeRoot(stmt.root, label, {
          statementText: stmt.statementText,
          missingIndexes: toMissingIndexSignals(stmt.missingIndexes),
        })
      }),
    }
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const root = parsePostgresJsonPlan(raw)
      return { engine: "postgres", statements: [analyzeRoot(root, "Query")] }
    } catch (pgErr) {
      if (!(pgErr instanceof PlanParseError) || pgErr.code !== "NOT_A_PLAN") throw pgErr
    }
    const { root, queryTextRedacted } = parseSnowflakeOperatorStats(raw)
    return {
      engine: "snowflake",
      statements: [analyzeRoot(root, "Query", { queryTextRedacted })],
      queryTextRedacted,
    }
  }

  const root = parsePostgresTextPlan(raw)
  return { engine: "postgres", statements: [analyzeRoot(root, "Query")] }
}
