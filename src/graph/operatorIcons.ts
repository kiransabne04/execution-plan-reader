// Episode 18, Story 18.4 — operator icons, keyed on the normalized
// `operatorType` (not each engine's own raw label — see
// .claude/skills/plan-normalization/SKILL.md), per
// docs/12-ui-redesign-spec.md §3's icon table. Lives beside, not inside,
// the per-engine `operatorMap.ts` files: those map a raw engine label onto
// the shared `operatorType` vocabulary; this maps that shared vocabulary
// onto one shared icon set, which is a separate concern the three
// per-engine files shouldn't each duplicate.
//
// Same "every mapping table needs an explicit fallback, don't force a
// false equivalence" rule as the operator-type maps themselves: an
// `operatorType` with no natural icon fit falls back to `unknown` (a plain
// circle) rather than being crammed into a category it doesn't belong in.
// See this file's own test for the full, explicit list of which real
// `operatorType`s (drawn from every fixture in src/fixtures/) currently
// fall to that fallback — a tracked gap, not a silent absorption.

import {
  ArrowLineDown,
  ArrowsMerge,
  Circle,
  Function as FunctionIcon,
  Hash as HashIcon,
  MagnifyingGlass,
  Rows,
  SortAscending,
  type Icon,
} from "@phosphor-icons/react"

/** The seven categories spec §3's table names, plus the explicit fallback. */
export type OperatorIconKey = "limit" | "aggregate" | "sort" | "join" | "scan" | "hash" | "index" | "unknown"

export const OPERATOR_ICON_COMPONENT: Record<OperatorIconKey, Icon> = {
  limit: ArrowLineDown,
  aggregate: FunctionIcon,
  sort: SortAscending,
  join: ArrowsMerge,
  scan: Rows,
  hash: HashIcon,
  index: MagnifyingGlass,
  unknown: Circle,
}

/**
 * `operatorType` -> icon category. Spec §3 names exactly seven categories
 * by example ("Join (hash, merge, nested loop)", "Seq / table scan", …);
 * this extends each to the full family of `operatorType` values that
 * share the same real-world shape, across all three engines'
 * `operatorMap.ts` tables — e.g. every scan-shaped operator (subquery,
 * function, values, CTE, foreign, custom, …) reads as "scan", not just
 * Postgres's literal `Seq Scan`.
 *
 * Deliberately NOT mapped (fall to `unknown`): operators with no honest
 * fit to any of the seven categories — `bitmap`/`bitmap_and`/`bitmap_or`
 * (bitmap set-combination, not itself a scan/join/sort/hash/aggregate),
 * `append`/`merge_append`/`recursive_union`/`with_clause`/`materialize`/
 * `memoize`/`gather`/`gather_merge`/`lock_rows`/`modify_table`/`result`/
 * `project_set`/`filter`/`compute_scalar`/`spool`/`exchange`/`flatten`/
 * `grouping_sets`/`external_function`/`generator`. Forcing these into a
 * category they don't really belong to would be exactly the "false
 * equivalence" the plan-normalization skill warns against for the
 * operator-type maps themselves — the same discipline applies here.
 */
const OPERATOR_TYPE_TO_ICON_KEY: Record<string, OperatorIconKey> = {
  // Limit
  limit: "limit",

  // Aggregate / GroupAggregate (+ the rest of the aggregate/dedup family)
  aggregate: "aggregate",
  hash_aggregate: "aggregate",
  group_aggregate: "aggregate",
  window_agg: "aggregate",
  group: "aggregate",
  unique: "aggregate",
  hash_distinct: "aggregate",
  set_op: "aggregate",

  // Sort
  sort: "sort",
  sort_with_limit: "sort",

  // Join (hash, merge, nested loop)
  hash_join: "join",
  merge_join: "join",
  nested_loop_join: "join",
  join: "join", // Snowflake's undifferentiated Join — see snowflake/operatorMap.ts's own comment on why it can't split further
  cartesian_join: "join",

  // Seq / table scan (every scan-shaped operator, not just the literal "Seq Scan")
  seq_scan: "scan",
  bitmap_heap_scan: "scan",
  tid_scan: "scan",
  subquery_scan: "scan",
  function_scan: "scan",
  values_scan: "scan",
  cte_scan: "scan",
  named_tuplestore_scan: "scan",
  worktable_scan: "scan",
  foreign_scan: "scan",
  custom_scan: "scan",

  // Hash (the standalone hash-table-build operator — distinct from a hash JOIN, which is "join" above)
  hash: "hash",
  hash_union: "hash",

  // Index scan / seek
  index_scan: "index",
  index_only_scan: "index",
  index_seek: "index",
  bitmap_index_scan: "index",
  key_lookup: "index",
}

/** Fixture-drawn, exported for the taxonomy test — see this file's own
 * test for how it's used. Not exhaustive of every operatorType that could
 * ever appear, only what's actually been seen. */
export function operatorIconKey(operatorType: string): OperatorIconKey {
  return OPERATOR_TYPE_TO_ICON_KEY[operatorType] ?? "unknown"
}
