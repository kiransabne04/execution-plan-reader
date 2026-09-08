// Shared machinery between `poorPartitionPruning.ts` and
// `largeScanVolume.ts` — both need the exact same "was pruning poor on
// this node" judgment (30.2 uses it as one of its two OR-gated trigger
// signals), so this is one implementation, not two independently-typed
// copies that could drift.
//
// Snowflake-specific: `pruning.partitionsScanned`/`partitionsTotal` have
// no Postgres/SQL Server equivalent (see `PruningInfo`'s own doc comment
// in normalize.ts — those engines don't organize storage into pruning-
// relevant micro-partitions the way Snowflake does).

import type { PlanNode } from "../parsers/normalize"

/** Below this many TOTAL partitions, the table itself is too small for a
 * scanned-ratio judgment to mean anything — "do not warn on a tiny table"
 * (this story's own explicit instruction). A 3-of-5-partition scan is a
 * 60% ratio by the math, but there's nothing to prune meaningfully at
 * that scale. */
export const MIN_PARTITIONS_TOTAL_THRESHOLD = 100

/** Scanned-ratio at or above which pruning is judged poor. */
export const POOR_PRUNING_RATIO_THRESHOLD = 0.5

/** Above this ratio, poor pruning escalates to `critical`. */
export const SEVERE_PRUNING_RATIO_THRESHOLD = 0.9

export interface PruningRatio {
  partitionsScanned: number
  partitionsTotal: number
  ratio: number
}

/**
 * `undefined` when there isn't enough real data to judge (missing either
 * figure, a non-positive total, or a table too small to be meaningful —
 * "do not warn on a tiny table or tiny scan"). Callers check `ratio`
 * against their own threshold; this function only validates the inputs
 * are real and material enough to compute a ratio from at all.
 */
export function computePruningRatio(node: PlanNode): PruningRatio | undefined {
  const { partitionsScanned, partitionsTotal } = node.pruning ?? {}
  if (partitionsScanned === undefined || partitionsTotal === undefined) return undefined
  if (!Number.isFinite(partitionsScanned) || !Number.isFinite(partitionsTotal)) return undefined
  if (partitionsScanned < 0 || partitionsTotal <= 0) return undefined
  if (partitionsTotal < MIN_PARTITIONS_TOTAL_THRESHOLD) return undefined
  return { partitionsScanned, partitionsTotal, ratio: partitionsScanned / partitionsTotal }
}

export function isPruningPoor(node: PlanNode): boolean {
  const pruning = computePruningRatio(node)
  return pruning !== undefined && pruning.ratio >= POOR_PRUNING_RATIO_THRESHOLD
}
