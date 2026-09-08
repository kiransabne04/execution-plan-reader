import { memo } from "react"
import type { BatchHealth } from "./batchHealth"

export interface BatchStatementOverviewProps {
  health: BatchHealth
  onSelectStatement: (index: number) => void
}

/**
 * Episode 29, Stories 29.3/29.4 — a large stored-procedure batch's "where
 * do I even start" question, answered in one place above the statement tab
 * strip: a compact health rollup (worst/median score, critical-statement
 * count) and the top 3 statements worth inspecting (`statementRanking.ts`'s
 * own ranking, reused — not a second, independently-computed list). Only
 * rendered by the caller when `statements.length > 1` (same gate the tab
 * strip itself uses) — a single-statement plan has nothing to rank.
 */
function BatchStatementOverviewInner({ health, onSelectStatement }: BatchStatementOverviewProps) {
  if (health.topStatements.length === 0) return null

  return (
    <div className="plan-reader-page__batch-overview" data-testid="batch-statement-overview">
      <div className="plan-reader-page__batch-health">
        <span className="plan-reader-page__batch-health-stat">
          Worst: <strong>{health.worstScore ?? "—"}</strong>
        </span>
        <span className="plan-reader-page__batch-health-stat">
          Median: <strong>{health.medianScore ?? "—"}</strong>
        </span>
        <span className="plan-reader-page__batch-health-stat">
          Critical statements: <strong>{health.criticalStatementCount}</strong>
        </span>
      </div>
      <div className="plan-reader-page__batch-top-statements">
        <span className="plan-reader-page__batch-top-statements-label">Top statements to inspect</span>
        <ol>
          {health.topStatements.map((stmt) => (
            <li key={stmt.index}>
              <button type="button" className="plan-reader-page__batch-top-statement" onClick={() => onSelectStatement(stmt.index)}>
                <span className="plan-reader-page__batch-top-statement-label">{stmt.label}</span>
                <span className="plan-reader-page__batch-top-statement-metric">
                  {stmt.durationMs !== undefined
                    ? `${stmt.durationMs.toFixed(1)}ms`
                    : stmt.estimatedCost !== undefined
                      ? `cost ${stmt.estimatedCost.toFixed(0)}`
                      : "—"}
                  {stmt.criticalFindingCount > 0 ? ` · ${stmt.criticalFindingCount} critical` : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export const BatchStatementOverview = memo(BatchStatementOverviewInner)
