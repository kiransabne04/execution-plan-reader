// `PlanNode` has no normalized "relation name" field — the field catalog
// (docs/10-node-stats-field-catalog.md) covers predicate/index/join/io/
// spill/pruning/parallel/timeBreakdown, but never promoted a table-identity
// field, since no rule or panel needed one until Episode 14's node-matching
// algorithm did. This reads it from the same per-engine `attributes` keys
// each parser already populates — no parser change required, per
// "normalization never discards information."
//
// Shared between src/comparison/matchNodes.ts (which first needed this,
// Episode 14) and src/graph/buildGraphElements.ts (Episode 18 Story 18.4's
// node subtitle) — one extraction, read the same way everywhere, rather
// than a third independent re-derivation. See
// .claude/skills/plan-normalization/SKILL.md.

import type { PlanNode } from "./normalize"

/**
 * Cross-engine attribute keys used here:
 * - Postgres: `attributes["Relation Name"]` (`src/parsers/postgres/*`)
 * - SQL Server: `attributes["Object.Table"]` + `attributes["Object.Schema"]`,
 *   bracket-quoted (`src/parsers/sqlserver/parseShowplanXml.ts`)
 * - Snowflake: `attributes["attr.table_name"]` (`src/parsers/snowflake/buildTree.ts`)
 */
export function relationIdentity(node: PlanNode): string | undefined {
  switch (node.engine) {
    case "postgres": {
      const relation = node.attributes["Relation Name"]
      return relation !== undefined ? String(relation) : undefined
    }
    case "sqlserver": {
      const table = node.attributes["Object.Table"]
      if (table === undefined) return undefined
      const schema = node.attributes["Object.Schema"]
      return schema !== undefined ? `${stripBrackets(String(schema))}.${stripBrackets(String(table))}` : stripBrackets(String(table))
    }
    case "snowflake": {
      const table = node.attributes["attr.table_name"]
      return table !== undefined ? String(table) : undefined
    }
    default:
      return undefined
  }
}

/**
 * Index identity. `node.index?.name` is the normalized field (populated
 * today only by the SQL Server parser — see `src/parsers/sqlserver/parseShowplanXml.ts`);
 * Postgres never promotes it onto `PlanNode.index`, so this falls back to
 * the raw `attributes["Index Name"]` the text/JSON parsers do set. Snowflake
 * has no per-node index concept (micro-partition pruning instead, see
 * `PruningInfo`), so it's intentionally absent here.
 */
export function indexIdentity(node: PlanNode): string | undefined {
  if (node.index?.name) return node.index.name
  const raw = node.attributes["Index Name"]
  return raw !== undefined ? String(raw) : undefined
}

export function stripBrackets(value: string): string {
  return value.replace(/^\[|\]$/g, "")
}
