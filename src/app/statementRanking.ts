// Episode 29, Story 29.3 — ranks a batch's statements so a large stored-
// procedure plan's "which of these hundreds of statements should I
// actually look at" question has a real answer, not just tab order.
// Reuses `statementTabSummary.ts`'s own existing per-statement helpers
// (`formatStatementDuration`, `statementSeverity`, `isTrivialStatement`)
// rather than independently re-deriving any of them.

import { collectAllFindings } from "../rules/findings"
import { isTrivialStatement } from "./statementTabSummary"
import type { PlanNode } from "../parsers/normalize"

/** Sums `io.bufferHits + io.bufferReads` across every node in a statement's
 * tree — `undefined` (never 0) when no node anywhere in the tree has
 * either field, the same "absence is meaningful" convention every other
 * aggregate in this codebase follows. Postgres/SQL Server only; Snowflake
 * exposes no comparable reads COUNT (see `IoInfo`'s own doc comment in
 * normalize.ts) and simply never contributes here. */
export function computeTotalReads(root: PlanNode): number | undefined {
  let total = 0
  let seen = false
  const walk = (node: PlanNode) => {
    if (node.io?.bufferHits !== undefined) {
      total += node.io.bufferHits
      seen = true
    }
    if (node.io?.bufferReads !== undefined) {
      total += node.io.bufferReads
      seen = true
    }
    node.children.forEach(walk)
  }
  walk(root)
  return seen ? total : undefined
}

function countCriticalFindings(root: PlanNode): number {
  return collectAllFindings(root).filter((f) => f.warning.severity === "critical").length
}

export interface StatementRankInfo {
  /** Index into the batch's own `statements` array — how a UI jumps back
   * to this statement (`switchToStatement`), never re-derived elsewhere. */
  index: number
  label: string
  /** Real actual-execution duration in ms, when the plan has ANALYZE-style
   * data — `undefined` for an estimate-only statement. */
  durationMs?: number
  /** The fallback ranking metric when NO statement in the batch has a real
   * duration at all (a compiled-only batch) — never mixed directly against
   * `durationMs` values from other statements (different units). */
  estimatedCost?: number
  criticalFindingCount: number
  totalReads?: number
  /** 1-based position in the ranked (not the original tab) order. */
  rank: number
}

interface PrimaryMetric {
  kind: "duration" | "cost" | "none"
  value: number
}

function primaryMetric(root: PlanNode): PrimaryMetric {
  if (root.actualTimeMs !== undefined) return { kind: "duration", value: root.actualTimeMs }
  if (root.estimatedCost !== undefined) return { kind: "cost", value: root.estimatedCost }
  return { kind: "none", value: 0 }
}

const KIND_RANK: Record<PrimaryMetric["kind"], number> = { duration: 0, cost: 1, none: 2 }

/**
 * Ranks every NON-trivial statement (a large batch's DECLARE/control-flow
 * statements are excluded — the same `isTrivialStatement` filter the tab
 * strip already collapses them by, reused rather than a second definition
 * of "nothing here"). Sort: real duration (descending) ranks above
 * compiled-only cost (descending), which ranks above statements with
 * neither; critical-finding-count then total-reads break ties WITHIN each
 * of those groups — never compared directly across groups, since ms/cost/
 * count/reads are not the same unit.
 */
export function rankStatements(statements: { root: PlanNode; label: string }[]): StatementRankInfo[] {
  const candidates = statements
    .map((stmt, index) => ({ stmt, index }))
    .filter(({ stmt }) => !isTrivialStatement(stmt.root))

  const withMetrics = candidates.map(({ stmt, index }) => {
    const metric = primaryMetric(stmt.root)
    return {
      index,
      label: stmt.label,
      durationMs: metric.kind === "duration" ? metric.value : undefined,
      estimatedCost: metric.kind === "cost" ? metric.value : undefined,
      criticalFindingCount: countCriticalFindings(stmt.root),
      totalReads: computeTotalReads(stmt.root),
      _metric: metric,
    }
  })

  withMetrics.sort((a, b) => {
    const kindDiff = KIND_RANK[a._metric.kind] - KIND_RANK[b._metric.kind]
    if (kindDiff !== 0) return kindDiff
    if (a._metric.kind !== "none") {
      const valueDiff = b._metric.value - a._metric.value
      if (valueDiff !== 0) return valueDiff
    }
    const criticalDiff = b.criticalFindingCount - a.criticalFindingCount
    if (criticalDiff !== 0) return criticalDiff
    return (b.totalReads ?? 0) - (a.totalReads ?? 0)
  })

  return withMetrics.map(({ _metric, ...rest }, i) => ({ ...rest, rank: i + 1 }))
}
