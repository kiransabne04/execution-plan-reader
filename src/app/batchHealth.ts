// Episode 29, Story 29.4 — a whole-batch Query Health summary. `computeQueryHealth`
// itself stays per-statement (unchanged) — this is a thin aggregation layer
// on top, the same "reuse, don't re-derive" relationship `statementRanking.ts`
// has with `statementTabSummary.ts`'s own per-statement helpers.

import { computeQueryHealth, type DimensionScored } from "../rules/queryHealth"
import { isTrivialStatement, statementSeverity } from "./statementTabSummary"
import { rankStatements, type StatementRankInfo } from "./statementRanking"
import type { AnalyzedStatement } from "./analyzePlan"

export interface BatchHealth {
  /** `undefined` when every non-trivial statement was itself "insufficient
   * data" (e.g. a batch of pure control-flow, or no statement had ANY
   * scoreable dimension) — never a fabricated 100/0. */
  worstScore?: number
  medianScore?: number
  /** A statement with at least one critical-severity finding — reuses
   * `statementSeverity`'s own definition (the same one the tab strip's
   * severity dot already uses) rather than a new score-threshold. */
  criticalStatementCount: number
  /** Top 3 by `statementRanking.ts`'s own ranking — one ranking, reused,
   * not a second independently-computed "worst" list that could disagree
   * with the batch's own "Top statements to inspect" panel. */
  topStatements: StatementRankInfo[]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A single statement's own Query Health `overall` score, but only when
 * genuinely scored (Query Health's own `insufficient-data` status is
 * never coerced into a number) and the statement isn't trivial —
 * `isTrivialStatement`'s pre-existing definition, so a large stored-
 * procedure batch's hundreds of `DECLARE`s don't skew the median.
 */
function scoredStatements(statements: AnalyzedStatement[]): number[] {
  return statements
    .filter((s) => !isTrivialStatement(s.root))
    .map((s) => computeQueryHealth(s.root, s.context).overall)
    .filter((overall): overall is DimensionScored => overall.status === "scored")
    .map((overall) => overall.score)
}

export function computeBatchHealth(statements: AnalyzedStatement[]): BatchHealth {
  const scores = scoredStatements(statements)
  const nonTrivial = statements.filter((s) => !isTrivialStatement(s.root))
  const criticalStatementCount = nonTrivial.filter((s) => statementSeverity(s.root) === "critical").length

  return {
    worstScore: scores.length > 0 ? Math.min(...scores) : undefined,
    medianScore: scores.length > 0 ? median(scores) : undefined,
    criticalStatementCount,
    topStatements: rankStatements(statements.map((s) => ({ root: s.root, label: s.label }))).slice(0, 3),
  }
}
