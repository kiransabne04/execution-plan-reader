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
  id: string
  severity: "info" | "warning" | "critical"
  shortText: string
  longText: string
  link?: string
}

export interface PlanNode {
  id: string
  engine: Engine
  operatorType: string // normalized (e.g. "seq_scan", "index_scan", "hash_join")
  rawOperatorLabel: string // original engine-specific label, always preserved
  estimatedRows?: number
  actualRows?: number
  estimatedCost?: number
  actualTimeMs?: number
  loops?: number
  role: PlanNodeRole
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
