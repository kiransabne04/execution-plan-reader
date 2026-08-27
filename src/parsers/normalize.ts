// Episode 4 — shared PlanNode model that every engine parser compiles down to.
// See .claude/skills/plan-normalization/SKILL.md before editing this file.

export type Engine = "postgres" | "sqlserver" | "snowflake"

/**
 * Where a node sits relative to the main top-to-bottom execution flow.
 * InitPlan/SubPlan nodes (Postgres) and similar constructs in other engines
 * are not part of the primary path and must be tagged so the graph layer
 * can render them distinctly (e.g. a side branch) rather than inline.
 */
export type PlanNodeRole = "main" | "init" | "sub"

export interface Warning {
  ruleId: string
  severity: "info" | "warning" | "critical"
  shortText: string // beginner-depth default
  longText: string // expert-depth / detail panel
  learnMoreUrl?: string // link into existing @scalingbackend content, when available
}

/**
 * Logical join semantics (inner/outer/semi/anti/cross) — a separate axis
 * from the join *algorithm* (hash/nested-loop/merge), which is already
 * captured by `operatorType`. See docs/10-node-stats-field-catalog.md §3.
 */
export type JoinLogicalType = "inner" | "left_outer" | "right_outer" | "full_outer" | "semi" | "anti" | "cross"

export interface PredicateInfo {
  /** A WHERE-style residual condition applied after reading a row. */
  filter?: string
  /** A condition satisfied by an index seek/range itself, not a post-filter. */
  indexCondition?: string
  /** The ON/USING condition for a join operator. */
  joinCondition?: string
}

export interface IndexInfo {
  name?: string
  /** Normalized where determinable; "not available from the plan alone" is
   * a real, honest state for some engines (see field catalog §2), not a bug. */
  type?: "btree" | "hash" | "gin" | "gist" | "clustered" | "nonclustered" | "columnstore" | "heap" | "bitmap" | "unknown"
  scanDirection?: string
}

export interface JoinInfo {
  logicalType?: JoinLogicalType
}

export interface IoInfo {
  /** Pages/blocks served from cache. */
  bufferHits?: number
  /** Pages/blocks read from disk. */
  bufferReads?: number
  /** Derived: bufferHits / (bufferHits + bufferReads), where computable. */
  cacheHitRatio?: number
  ioReadTimeMs?: number
  ioWriteTimeMs?: number
  /** Snowflake-specific — no direct Postgres/SQL Server equivalent. */
  bytesScanned?: number
}

export interface SpillInfo {
  occurred: boolean
  bytesLocal?: number
  /** Snowflake-specific distinction; Postgres/SQL Server don't separate local/remote. */
  bytesRemote?: number
  /** Engine-specific free text (e.g. SQL Server's spill level, sort vs. hash spill). */
  detail?: string
}

/** Snowflake-specific — no Postgres/SQL Server equivalent (those engines
 * don't organize storage into pruning-relevant micro-partitions). */
export interface PruningInfo {
  partitionsScanned?: number
  partitionsTotal?: number
}

export interface ParallelInfo {
  workersLaunched?: number
  workersPlanned?: number
}

/** Snowflake-specific — no Postgres/SQL Server equivalent. Snowflake doesn't
 * report a per-node elapsed-ms figure (see field catalog §7); instead each
 * component is a percentage of the *query's* total elapsed time. `actualTimeMs`
 * intentionally stays undefined for Snowflake nodes rather than misrepresent
 * a percentage as milliseconds — this is the honest, comparable-across-nodes
 * figure Snowflake actually gives you. */
export interface TimeBreakdownInfo {
  /** This node's share of the whole query's elapsed time, 0-100. */
  overallPercentage?: number
  initializationPercentage?: number
  processingPercentage?: number
  synchronizationPercentage?: number
  localDiskIoPercentage?: number
  remoteDiskIoPercentage?: number
  networkCommunicationPercentage?: number
}

export interface PlanNode {
  id: string
  engine: Engine
  operatorType: string // normalized (e.g. "seq_scan", "index_scan", "hash_join")
  rawOperatorLabel: string // original engine-specific label, always preserved
  estimatedRows?: number
  actualRows?: number
  /** Rows read but discarded by a post-scan filter, where derivable. */
  rowsRemovedByFilter?: number
  estimatedCost?: number
  /** As reported by the engine — see docs/10-node-stats-field-catalog.md §7
   * for exactly what "as reported" means per engine (Postgres: already
   * loop-averaged; SQL Server: summed across threads for a parallel
   * operator; Snowflake: not a comparable figure at all). */
  actualTimeMs?: number
  /** Derived per-execution approximation, explicitly separate from the raw
   * cumulated figure above so the two are never presented as the same
   * number — see the field catalog's correction: this is primarily a
   * parallel-worker/thread concern, not a Postgres loop-averaging one
   * (Postgres's actualTimeMs is already loop-averaged by the engine itself). */
  actualTimePerExecutionMs?: number
  loops?: number
  role: PlanNodeRole

  // Promoted, normalized sub-fields covering exactly the categories the
  // node detail panel needs (Episode 6 Story 6.2) — every field here is
  // optional, and absence is meaningful ("this engine/operator doesn't
  // expose this"), never papered over with a fabricated value. See
  // docs/10-node-stats-field-catalog.md, the authoritative source for this
  // part of the model.
  predicate?: PredicateInfo
  index?: IndexInfo
  join?: JoinInfo
  io?: IoInfo
  spill?: SpillInfo
  pruning?: PruningInfo
  parallel?: ParallelInfo
  timeBreakdown?: TimeBreakdownInfo

  children: PlanNode[]
  // Engine-specific extras, untouched. Non-primitive raw values (arrays/objects,
  // e.g. Postgres's per-worker `Workers` data) are preserved as JSON strings so
  // this stays a flat Record without silently dropping structure.
  attributes: Record<string, string | number>
  warnings: Warning[] // populated later, by the rule engine — not here
}

/**
 * Structured parse error. Per the privacy-architecture skill, the `message`
 * must describe structure ("JSON parse failed at position 412") and must
 * NEVER include a snippet of the raw pasted input.
 */
export type PlanParseErrorCode =
  | "EMPTY_INPUT"
  | "EMPTY_RESULT"
  | "TRUNCATED_INPUT"
  | "NOT_A_PLAN"
  | "INVALID_JSON"
  | "INVALID_XML"

export class PlanParseError extends Error {
  readonly code: PlanParseErrorCode
  readonly position?: number

  constructor(code: PlanParseErrorCode, message: string, position?: number) {
    super(message)
    this.name = "PlanParseError"
    this.code = code
    this.position = position
  }
}

/**
 * Depth-first walk collecting each node exactly once, deduped by `id`. Plain
 * recursion would double-count a node reachable via more than one parent —
 * Snowflake's multi-parent DAG nodes (see the snowflake-plan-parsing skill)
 * are the case this matters for, but it's harmless (a no-op dedup) for the
 * strict trees Postgres and SQL Server always produce.
 */
export function collectNodes(root: PlanNode): PlanNode[] {
  const result: PlanNode[] = []
  const seen = new Set<string>()
  const walk = (node: PlanNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
    node.children.forEach(walk)
  }
  walk(root)
  return result
}

/**
 * Maps free-text join-type wording (Postgres's `Join Type`, SQL Server's
 * `LogicalOp`, Snowflake's `join_type`) to the shared `JoinLogicalType`
 * vocabulary. Keyword-based rather than an exact-match table since each
 * engine phrases this differently ("Left" vs "LEFT OUTER" vs "Left Outer
 * Join") — returns `undefined` (an honest gap) rather than guessing when
 * nothing recognizable is present.
 */
export function normalizeJoinLogicalType(raw: string | undefined): JoinLogicalType | undefined {
  if (!raw) return undefined
  const text = raw.toLowerCase()
  if (text.includes("full")) return "full_outer"
  if (text.includes("left")) return "left_outer"
  if (text.includes("right")) return "right_outer"
  if (text.includes("anti")) return "anti"
  if (text.includes("semi")) return "semi"
  if (text.includes("cross")) return "cross"
  if (text.includes("inner")) return "inner"
  return undefined
}

/** Only computable when both figures are actually present — never fabricates
 * a ratio from a missing/zero denominator (see field catalog §5). */
export function computeCacheHitRatio(hits: number | undefined, reads: number | undefined): number | undefined {
  if (hits === undefined || reads === undefined || !Number.isFinite(hits) || !Number.isFinite(reads)) return undefined
  const total = hits + reads
  if (total <= 0) return undefined
  return hits / total
}
