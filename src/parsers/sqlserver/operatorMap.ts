// PhysicalOp (+ LogicalOp, where PhysicalOp alone is ambiguous) -> operatorType
// mapping table for SQL Server Showplan XML. See
// .claude/skills/plan-normalization/SKILL.md: every mapping table needs an
// explicit "unknown" fallback, and operator vocabularies that genuinely
// diverge across engines (Key Lookup, Spool) should NOT be forced into a
// false cross-engine equivalence.

export const UNKNOWN_OPERATOR_TYPE = "unknown"

const DIRECT_PHYSICAL_OP_MAP: Record<string, string> = {
  "Table Scan": "seq_scan",
  "Clustered Index Scan": "index_scan",
  "Index Scan": "index_scan",
  "Clustered Index Seek": "index_seek",
  "Index Seek": "index_seek",
  "Key Lookup": "key_lookup",
  "RID Lookup": "key_lookup",
  "Nested Loops": "nested_loop_join",
  "Merge Join": "merge_join",
  Sort: "sort",
  "Stream Aggregate": "group_aggregate",
  Filter: "filter",
  "Compute Scalar": "compute_scalar",
  Concatenation: "append",
  Top: "limit",
  Bitmap: "bitmap",
  "Table Spool": "spool",
  "Index Spool": "spool",
  "Row Count Spool": "spool",
  "Table Insert": "modify_table",
  "Clustered Index Insert": "modify_table",
  "Table Update": "modify_table",
  "Clustered Index Update": "modify_table",
  "Table Delete": "modify_table",
  "Clustered Index Delete": "modify_table",
  "Table Merge": "modify_table",
}

// "Hash Match" is used by SQL Server for hash joins, hash aggregates, hash
// distinct, and hash union alike — PhysicalOp alone can't disambiguate.
// LogicalOp tells us which.
function mapHashMatch(logicalOp: string | undefined): string {
  const op = (logicalOp ?? "").toLowerCase()
  if (op.includes("join")) return "hash_join"
  if (op.includes("aggregate")) return "hash_aggregate"
  if (op.includes("distinct")) return "hash_distinct"
  if (op.includes("union")) return "hash_union"
  return UNKNOWN_OPERATOR_TYPE
}

// "Parallelism" covers several distinct exchange operators, again
// disambiguated by LogicalOp.
function mapParallelism(logicalOp: string | undefined): string {
  const op = (logicalOp ?? "").toLowerCase()
  if (op.includes("gather")) return "gather"
  if (op.includes("distribute") || op.includes("repartition")) return "exchange"
  return "exchange"
}

export function mapSqlServerOperatorType(physicalOp: string, logicalOp?: string): string {
  if (physicalOp === "Hash Match") return mapHashMatch(logicalOp)
  if (physicalOp === "Parallelism") return mapParallelism(logicalOp)
  return DIRECT_PHYSICAL_OP_MAP[physicalOp] ?? UNKNOWN_OPERATOR_TYPE
}
