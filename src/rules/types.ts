// Episode 5 — rule engine. See .claude/skills/rule-engine-authoring/SKILL.md
// before editing anything in this directory.

import { collectNodes, type Engine, type PlanNode, type Warning } from "../parsers/normalize"

/** SQL Server's own missing-index recommendation, decoupled from
 * `parsers/sqlserver`'s exact type so rules only ever depend on the shared
 * normalize.ts contract, never reach into a specific engine parser. */
export interface MissingIndexSignal {
  impact?: number
  table?: string
  equalityColumns: string[]
  inequalityColumns: string[]
  includedColumns: string[]
}

/** Whole-tree information a single-node rule might need beyond what's on
 * the node itself (e.g. relative severity scoring, or plan-level signals
 * like "this statement uses parameters" that don't belong to one node). */
export interface PlanContext {
  engine: Engine
  rootId: string
  totalEstimatedCost?: number
  totalActualTimeMs?: number
  nodeCount: number
  hasActualData: boolean
  statementText?: string
  missingIndexes?: MissingIndexSignal[]
  /** Snowflake-only: the account has query-text redaction enabled — used by
   * the detail panel's query-correlation section to state the reason
   * plainly rather than silently showing nothing (see graph-visualization
   * skill). Not a rule-engine signal itself. */
  queryTextRedacted?: boolean
}

export function buildPlanContext(
  root: PlanNode,
  extra?: Partial<Pick<PlanContext, "statementText" | "missingIndexes" | "queryTextRedacted">>,
): PlanContext {
  const nodes = collectNodes(root)
  const hasActualData = nodes.some((n) => n.actualRows !== undefined || n.actualTimeMs !== undefined)
  return {
    engine: root.engine,
    rootId: root.id,
    totalEstimatedCost: root.estimatedCost,
    totalActualTimeMs: root.actualTimeMs,
    nodeCount: nodes.length,
    hasActualData,
    statementText: extra?.statementText,
    missingIndexes: extra?.missingIndexes,
    queryTextRedacted: extra?.queryTextRedacted,
  }
}

/**
 * Every rule is a pure function: no shared mutable state, deterministic
 * (same PlanNode + PlanContext always produces the same Warning[]). This is
 * what keeps the rule engine itself trustworthy and, later, what makes the
 * opt-in LLM narrative mode safe to build on — it only ever phrases already-
 * validated facts this layer produced, never invents its own diagnosis.
 */
export type Rule = (node: PlanNode, context: PlanContext) => Warning[]
