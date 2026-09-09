// Episode 13, Story 13.1 — category labels for the "All findings" view's
// category filter. Purely a display concern layered on top of the rule
// engine's own output (ruleId), so it lives next to the rules rather than
// in the graph layer, matching the pattern of Warning.shortText/longText
// being authored once here and consumed by multiple UI surfaces. See
// .claude/skills/rule-engine-authoring/SKILL.md.

import type { Warning } from "../parsers/normalize"
import { ruleFamily } from "./summarize"

export type FindingCategory =
  | "Scan issues"
  | "Index issues"
  | "Join issues"
  | "Estimate issues"
  | "Spill issues"
  | "I/O issues"
  | "Loop issues"
  | "Parallelism issues"
  | "Planning issues"
  | "Caching issues"
  | "Partition issues"
  | "Aggregation issues"
  | "Window issues"
  | "General notes"

// One entry per rule family currently in ALL_RULES (src/rules/index.ts).
// Adding a new rule without adding it here isn't a crash — it just falls
// back to "General notes" below — but keep this in sync so filtering stays
// useful rather than dumping new rules into a catch-all bucket.
const RULE_FAMILY_CATEGORY: Record<string, FindingCategory> = {
  "seq-scan-on-large-table": "Scan issues",
  "missing-index-opportunity": "Index issues",
  "non-sargable-predicate": "Index issues",
  "exploding-join": "Join issues",
  // Episode 32 — Snowflake structural CartesianJoin classification.
  "cartesian-join": "Join issues",
  "aggregation-hotspot": "Aggregation issues",
  "window-hotspot": "Window issues",
  // Story 32.5 — same bucket as the other sort-spill rules (sort-disk/
  // sort-large/sqlserver-sort-spill) since it's a Sort-specific finding,
  // not a new category, even though its trigger can be time-only.
  "sort-hotspot": "Spill issues",
  "bad-row-estimate": "Estimate issues",
  "disk-spill": "Spill issues",
  "buffer-cache-inefficiency": "I/O issues",
  "high-loop-count": "Loop issues",
  "parallel-worker-shortfall": "Parallelism issues",
  // Episode 24 — Postgres advanced rules.
  "index-only-heap-fetches": "Scan issues",
  "filter-rows-discarded": "Scan issues",
  "join-filter-rows-discarded": "Join issues",
  "hash-batching": "Spill issues",
  "sort-disk": "Spill issues",
  "sort-large": "Spill issues",
  "temp-io": "Spill issues",
  "planning-overhead": "Planning issues",
  "jit-overhead": "Planning issues",
  "materialize-repeated": "Loop issues",
  "memoize-low-hit-rate": "Caching issues",
  "memoize-evictions": "Caching issues",
  "partition-fanout": "Partition issues",
  "wal-volume": "I/O issues",
  // Episode 25 — Postgres cross-node reasoning.
  "nested-loop-explosion": "Loop issues",
  "parameter-sensitivity-honesty-note": "General notes",
  "estimate-only-plan": "General notes",
  // SQL Server — key lookup explosion (same "repeated-execution" family as
  // nested-loop-explosion, just a different engine/operator).
  "key-lookup-explosion": "Loop issues",
  // SQL Server — residual predicate heavy (same bucket as the engine-
  // agnostic filter-rows-discarded it specializes).
  "residual-predicate-heavy": "Scan issues",
  // SQL Server — implicit conversion (same bucket as non-sargable-predicate,
  // a structurally similar "may prevent index use" text-pattern finding).
  "implicit-conversion": "Index issues",
  // SQL Server — sort spill (same bucket as disk-spill/sort-disk/sort-large,
  // which this specializes with SQL-Server-specific spill-level detail).
  "sqlserver-sort-spill": "Spill issues",
  // SQL Server — hash spill (same bucket as sqlserver-sort-spill, its
  // Hash Match companion).
  "sqlserver-hash-spill": "Spill issues",
  // SQL Server — memory grant (a spill-adjacent memory concern, same
  // bucket as disk-spill/sort-disk/sort-large/the two sqlserver spill rules).
  "memory-grant-excessive": "Spill issues",
  "memory-grant-pressure": "Spill issues",
  "memory-grant-feedback": "General notes",
  // Episode 28 — SQL Server spool, parallelism, and modern operators.
  "table-spool-expensive": "Loop issues",
  "index-spool-repeated": "Loop issues",
  "parallel-thread-skew": "Parallelism issues",
  "exchange-data-movement": "Parallelism issues",
  "adaptive-join": "General notes",
  "execution-mode": "General notes",
  // Episode 30 — Snowflake pruning/scan-volume reasoning (same bucket as
  // filter-rows-discarded/missing-index-opportunity — access-efficiency
  // concerns, not caching).
  "poor-partition-pruning": "Scan issues",
  "large-scan-volume": "Scan issues",
  // Episode 31 — Snowflake spill/time-breakdown reasoning.
  "remote-spill": "Spill issues",
  "local-spill": "Spill issues",
  "network-time-dominant": "I/O issues",
  "synchronization-overhead": "Parallelism issues",
  "dominant-time-component": "General notes",
}

export function categorizeFinding(warning: Warning): FindingCategory {
  return RULE_FAMILY_CATEGORY[ruleFamily(warning.ruleId)] ?? "General notes"
}

/** Episode 18, Story 18.13 — the content stack's own "seen but unmapped"
 * validation (`posts.test.ts`) checks a post's `ruleIds` against this same
 * canonical rule-family list, rather than maintaining a second one. */
export const KNOWN_RULE_FAMILIES: readonly string[] = Object.keys(RULE_FAMILY_CATEGORY)

/** Stable display order for the category filter — roughly execution-path
 * order (scan -> index -> join -> estimate -> spill -> loop), general notes
 * last since they're plan-wide rather than operator-specific. */
export const FINDING_CATEGORY_ORDER: FindingCategory[] = [
  "Scan issues",
  "Index issues",
  "Join issues",
  "Estimate issues",
  "Spill issues",
  "I/O issues",
  "Loop issues",
  "Parallelism issues",
  "Planning issues",
  "Caching issues",
  "Partition issues",
  "Aggregation issues",
  "Window issues",
  "General notes",
]
