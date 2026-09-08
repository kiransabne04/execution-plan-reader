// Shared machinery between `sqlServerTableSpoolExpensive.ts` and
// `sqlServerIndexSpool.ts` — both operators cache an intermediate result so
// a correlated inner side (typically under a Nested Loop) doesn't have to
// recompute it from scratch on every outer row. `ActualRebinds`/
// `ActualRewinds` (`RunTimeCountersPerThread`, summed like every other
// per-thread counter — see `parseShowplanXml.ts`) tell you whether that
// caching actually worked:
// - A REWIND means the cached result could be reused as-is — the caching
//   is doing its job.
// - A REBIND means a correlated parameter changed, so the cache had to be
//   fully rebuilt — the caching bought nothing for that access.
//
// A spool dominated by rebinds is the worse case (the cache is rebuilt
// almost every time, so its own overhead is close to pure loss); one
// dominated by rewinds is working as designed, though the total volume
// materialized can still be worth flagging if it's simply large.

import { formatNumber } from "./format"

/** At or above this combined rebind+rewind count, the spool is being
 * accessed repeatedly enough to matter — independent of the row/runtime
 * volume floor each rule applies on top of this. */
export const REPEATED_ACCESS_THRESHOLD = 1_000

/** At or above this share of accesses being rebinds (not rewinds), the
 * cache is judged largely ineffective — escalates severity to `critical`. */
export const HIGH_REBIND_SHARE_THRESHOLD = 0.5

export interface RebindRewindStats {
  rebinds: number
  rewinds: number
  total: number
  rebindShare: number
}

/** `undefined` when there isn't enough data to compute this at all — a
 * plan where this parser gap genuinely applies, or an estimate-only node. */
export function computeRebindRewindStats(rebinds: number | undefined, rewinds: number | undefined): RebindRewindStats | undefined {
  if (rebinds === undefined && rewinds === undefined) return undefined
  const r = rebinds !== undefined && Number.isFinite(rebinds) && rebinds >= 0 ? rebinds : 0
  const w = rewinds !== undefined && Number.isFinite(rewinds) && rewinds >= 0 ? rewinds : 0
  const total = r + w
  if (total <= 0) return undefined
  return { rebinds: r, rewinds: w, total, rebindShare: r / total }
}

export function spoolSeverity(stats: RebindRewindStats): "warning" | "critical" {
  return stats.rebindShare >= HIGH_REBIND_SHARE_THRESHOLD ? "critical" : "warning"
}

/** Explains what the rebind/rewind split actually means, without asserting
 * a specific fix — that's each rule's own job, since a Table Spool and an
 * Index Spool warrant different fix framing. */
export function rebindRewindExplanation(stats: RebindRewindStats): string {
  const rebindText = `${formatNumber(stats.rebinds)} rebind${stats.rebinds === 1 ? "" : "s"}`
  const rewindText = `${formatNumber(stats.rewinds)} rewind${stats.rewinds === 1 ? "" : "s"}`
  if (stats.rebindShare >= HIGH_REBIND_SHARE_THRESHOLD) {
    return (
      `Of ${formatNumber(stats.total)} accesses, ${rebindText} required a full rebuild versus only ${rewindText} that ` +
      `could reuse the cached result as-is — the cache is being rebuilt most of the time, so it's buying little over ` +
      `just recomputing the subtree directly.`
    )
  }
  return (
    `Of ${formatNumber(stats.total)} accesses, ${rewindText} reused the cached result as-is versus only ${rebindText} ` +
    `that needed a full rebuild — the caching itself is working as intended; the volume materialized in the first ` +
    `place is what's worth looking at.`
  )
}
