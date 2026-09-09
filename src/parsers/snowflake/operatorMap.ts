// operation/operator_type -> operatorType mapping table for Snowflake. See
// .claude/skills/plan-normalization/SKILL.md: explicit "unknown" fallback,
// and operator concepts with no honest cross-engine equivalent (Flatten,
// WithClause's materialize-vs-reference split) are kept distinct rather
// than forced into a Postgres/SQL-Server-shaped box.

export const UNKNOWN_OPERATOR_TYPE = "unknown"

const DIRECT_MAP: Record<string, string> = {
  TableScan: "seq_scan",
  Filter: "filter",
  Aggregate: "aggregate",
  Join: "join", // Snowflake doesn't expose the physical join algorithm the
  // way Postgres/SQL Server do — no honest hash_join/merge_join split here.
  CartesianJoin: "cartesian_join",
  Sort: "sort",
  SortWithLimit: "sort_with_limit",
  Limit: "limit",
  WindowFunction: "window_agg",
  WithClause: "with_clause", // CTE materialization (definition site)
  WithReference: "cte_scan", // CTE reference (functionally a scan of it — legit parity with Postgres's CTE Scan)
  UnionAll: "append", // legit parity with Postgres's Append/UNION ALL
  Flatten: "flatten", // Snowflake-specific, no cross-engine equivalent
  GroupingSets: "grouping_sets",
  ExternalFunction: "external_function",
  Generator: "generator",
  Result: "result",
  InsertValuesClause: "values_scan",
  ValuesClause: "values_scan",
  // Episode 33, Story 33.9 — DML operators, the nodes `DmlInfo` stats
  // (`dml.number_of_rows_inserted`/etc.) actually attach to. No honest
  // cross-engine equivalent — Postgres/SQL Server's own parsers in this app
  // only ever handle read-only `EXPLAIN` output, never a DML plan, so
  // there's no existing "insert"/"update"/etc. operatorType to reuse or
  // collide with.
  Insert: "insert",
  Update: "update",
  Delete: "delete",
  Merge: "merge",
  Unload: "unload",
}

export function mapSnowflakeOperatorType(operation: string): string {
  return DIRECT_MAP[operation] ?? UNKNOWN_OPERATOR_TYPE
}
