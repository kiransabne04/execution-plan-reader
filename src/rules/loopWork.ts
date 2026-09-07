// Episode 25, Story 25.3 — the "loops × per-loop time" cumulative-work
// estimate, shared by `highLoopCount.ts` (any operator, engine-agnostic)
// and `pgNestedLoopExplosion.ts` (Postgres nested loops specifically).
// Both rules describe the exact same idea — "this many executions, each
// costing about this much, adds up to about this much repeated work" — so
// this is one formula, not two independently-computed copies that could
// silently drift apart from each other.
//
// This is ALWAYS an approximation, never a directly-measured Postgres/SQL
// Server metric: `actualTimeMs` (Postgres's `Actual Total Time`, already
// divided by loop count; SQL Server's per-execution average) is itself an
// AVERAGE across every loop iteration. Multiplying it back out by loop
// count assumes every iteration cost the same, which real executions
// don't guarantee — some rows will have been cheaper or more expensive to
// look up than others. Every caller must present the result as
// "approximately"/"roughly", never as if EXPLAIN reported one measured
// total inner-side duration.

/**
 * `loops × perLoopMs`, or `undefined` when either input is missing or
 * non-finite (an estimate-only plan with no ANALYZE data, or a degenerate
 * NaN/Infinity value) — "insufficient data" rather than a guessed number,
 * per this codebase's numeric-edge-case convention.
 */
export function computeCumulativeLoopWork(loops: number | undefined, perLoopMs: number | undefined): number | undefined {
  if (loops === undefined || perLoopMs === undefined) return undefined
  if (!Number.isFinite(loops) || !Number.isFinite(perLoopMs)) return undefined
  const total = loops * perLoopMs
  return Number.isFinite(total) ? total : undefined
}
