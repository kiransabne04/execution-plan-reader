// Shared machinery between `networkTimeDominant.ts`, `synchronizationOverhead.ts`,
// and `dominantTimeComponent.ts` — all three reason about the same
// `TimeBreakdownInfo` shape, and two of them need the exact same "high
// relative to this node's own time AND material relative to the whole
// query" dual-gate.
//
// Snowflake has NO per-node millisecond figure at all (`actualTimeMs`
// stays undefined by design — see `TimeBreakdownInfo`'s own doc comment
// in normalize.ts): every time figure it reports is a PERCENTAGE. This is
// the honest analog to "high percentage AND meaningful absolute runtime"
// that Postgres/SQL-Server-style rules express in milliseconds — there is
// no millisecond figure to require here, so "absolute" is expressed as
// this node's own `overallPercentage` (its share of the WHOLE query's
// time) being material, not just its `network`/`synchronization` share of
// ITS OWN time being high. A node that took 0.01% of the query's total
// time but spent 90% of that sliver on network communication has a high
// RELATIVE percentage and a trivial ABSOLUTE one — this dual-gate is what
// excludes that case.

export type TimeCategory = "processing" | "local disk" | "remote disk" | "network" | "synchronization"

export interface TimeBreakdownLike {
  overallPercentage?: number
  processingPercentage?: number
  localDiskIoPercentage?: number
  remoteDiskIoPercentage?: number
  networkCommunicationPercentage?: number
  synchronizationPercentage?: number
}

/** Below this share of the QUERY's total time, this node's own time isn't
 * material enough for any category's dominance within it to be worth
 * flagging — the "absolute" half of the dual-gate, shared by every rule
 * in this file's own family. */
export const MATERIAL_OVERALL_PERCENTAGE_THRESHOLD = 5

const CATEGORY_FIELDS: { category: TimeCategory; field: keyof TimeBreakdownLike }[] = [
  { category: "processing", field: "processingPercentage" },
  { category: "local disk", field: "localDiskIoPercentage" },
  { category: "remote disk", field: "remoteDiskIoPercentage" },
  { category: "network", field: "networkCommunicationPercentage" },
  { category: "synchronization", field: "synchronizationPercentage" },
]

export interface DominantCategory {
  category: TimeCategory
  percentage: number
}

/** `undefined` when no category has any real data at all. Ties broken by
 * `CATEGORY_FIELDS`'s own listed order (processing first) — deterministic,
 * never arbitrary object-key iteration order. */
export function dominantTimeCategory(tb: TimeBreakdownLike | undefined): DominantCategory | undefined {
  if (!tb) return undefined
  let best: DominantCategory | undefined
  for (const { category, field } of CATEGORY_FIELDS) {
    const value = tb[field]
    if (value === undefined || !Number.isFinite(value)) continue
    if (!best || value > best.percentage) best = { category, percentage: value }
  }
  return best
}

export function isOverallMaterial(tb: TimeBreakdownLike | undefined): boolean {
  const overall = tb?.overallPercentage
  return overall !== undefined && Number.isFinite(overall) && overall >= MATERIAL_OVERALL_PERCENTAGE_THRESHOLD
}
