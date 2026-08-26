// nativeLabel -> operatorType mapping table for Postgres `Node Type` values.
// See .claude/skills/plan-normalization/SKILL.md: every mapping table needs
// an explicit "unknown" fallback, and new operator labels seen in fixtures
// or real traffic should be added here rather than silently absorbed.

const POSTGRES_OPERATOR_MAP: Record<string, string> = {
  "Seq Scan": "seq_scan",
  "Index Scan": "index_scan",
  "Index Only Scan": "index_only_scan",
  "Bitmap Heap Scan": "bitmap_heap_scan",
  "Bitmap Index Scan": "bitmap_index_scan",
  BitmapAnd: "bitmap_and",
  BitmapOr: "bitmap_or",
  "Tid Scan": "tid_scan",
  "Subquery Scan": "subquery_scan",
  "Function Scan": "function_scan",
  "Values Scan": "values_scan",
  "CTE Scan": "cte_scan",
  "Named Tuplestore Scan": "named_tuplestore_scan",
  "WorkTable Scan": "worktable_scan",
  "Foreign Scan": "foreign_scan",
  "Custom Scan": "custom_scan",
  "Nested Loop": "nested_loop_join",
  "Hash Join": "hash_join",
  "Merge Join": "merge_join",
  Hash: "hash",
  Sort: "sort",
  Aggregate: "aggregate",
  HashAggregate: "hash_aggregate",
  GroupAggregate: "group_aggregate",
  WindowAgg: "window_agg",
  Group: "group",
  Unique: "unique",
  SetOp: "set_op",
  Limit: "limit",
  Append: "append",
  "Merge Append": "merge_append",
  "Recursive Union": "recursive_union",
  Result: "result",
  ProjectSet: "project_set",
  Materialize: "materialize",
  Memoize: "memoize",
  Gather: "gather",
  "Gather Merge": "gather_merge",
  "Lock Rows": "lock_rows",
  "Modify Table": "modify_table",
}

export const UNKNOWN_OPERATOR_TYPE = "unknown"

export function mapPostgresOperatorType(nodeType: string): string {
  return POSTGRES_OPERATOR_MAP[nodeType] ?? UNKNOWN_OPERATOR_TYPE
}
