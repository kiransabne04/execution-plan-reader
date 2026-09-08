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

/** Episode 29, Story 29.1 — SQL Server's compiled-vs-runtime parameter
 * values, decoupled from `parsers/sqlserver`'s exact `ParameterInfo` type
 * for the same reason `MissingIndexSignal` above is: rules only ever
 * depend on the shared `rules/types.ts` contract, never reach into a
 * specific engine parser. */
export interface ParameterSignal {
  name: string
  compiledValue?: string
  runtimeValue?: string
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
  /** Episode 23, Story 23.2 — surfaced from `root.parallel?.compiledDegreeOfParallelism`,
   * the exact same "root field -> context field" pattern `totalEstimatedCost`/
   * `totalActualTimeMs` above already use. SQL Server-only (see `ParallelInfo`'s
   * own doc comment, `normalize.ts`) — always `undefined` for Postgres/Snowflake. */
  compiledDegreeOfParallelism?: number
  statementText?: string
  missingIndexes?: MissingIndexSignal[]
  /** Episode 29, Story 29.1/29.2 — SQL Server-only, compile-vs-runtime
   * parameter values (see `ParameterSignal`'s own doc comment). `undefined`
   * (not an empty array) when the statement has no `ParameterList` at all
   * (a non-parameterized statement, or a non-SQL-Server engine) — kept
   * distinguishable from "parsed, genuinely zero parameters," the same
   * "absence is meaningful" convention `missingIndexes` above already uses. */
  parameters?: ParameterSignal[]
  /** Snowflake-only: the account has query-text redaction enabled — used by
   * the detail panel's query-correlation section to state the reason
   * plainly rather than silently showing nothing (see graph-visualization
   * skill). Not a rule-engine signal itself. */
  queryTextRedacted?: boolean
  /** Episode 25 — Design review (downloaded "expert overlay details" PNG),
   * spec §1f: the Expert panel's "Nth slowest of N" rank chip needs every
   * node's own actual-time/cost figure to rank against, which no rule
   * needs (every `Rule` reasons about its own node, or plan-wide scalars
   * already above) — a UI-only convenience, not read by any `Rule`. See
   * `computeNodeRank.ts`. */
  allNodes: PlanNode[]
}

export function buildPlanContext(
  root: PlanNode,
  extra?: Partial<Pick<PlanContext, "statementText" | "missingIndexes" | "queryTextRedacted" | "parameters">>,
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
    compiledDegreeOfParallelism: root.parallel?.compiledDegreeOfParallelism,
    statementText: extra?.statementText,
    missingIndexes: extra?.missingIndexes,
    queryTextRedacted: extra?.queryTextRedacted,
    parameters: extra?.parameters,
    allNodes: nodes,
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
