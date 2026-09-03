// Episode 24, Story 24.7 — planning time dominating execution time. A
// whole-query, root-node-only comparison (mirrors `parameterSensitivityNote.ts`'s
// own `node.id !== context.rootId` guard) between Postgres's own top-level
// `Planning Time`/`Execution Time` figures (Story 24.7's own new
// `planningTimeMs`/`executionTimeMs` fields, `normalize.ts`). This can
// matter a lot for a high-frequency workload (planning cost paid on every
// single execution, unlike a cached/prepared statement) but is
// unremarkable for a one-off report query — this rule states the
// observable fact, not which of those this particular query is.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this, planning time is trivial in absolute terms regardless of
 * ratio — this story's own explicit example (0.3ms planning / 0.05ms
 * execution, a 6x ratio) must NOT fire, which only an absolute floor
 * (not a ratio threshold alone) can guarantee. */
export const MIN_PLANNING_MS_THRESHOLD = 50

/** Planning must be at least this many times execution to be worth
 * calling out as "dominating" — not just "somewhat more than." */
export const DOMINANCE_RATIO_THRESHOLD = 1

export const planningOverhead: Rule = (node, context) => {
  if (node.id !== context.rootId) return []
  const planningMs = node.planningTimeMs
  if (planningMs === undefined || !Number.isFinite(planningMs) || planningMs < MIN_PLANNING_MS_THRESHOLD) return []

  const executionMs = node.executionTimeMs
  // No execution figure at all (e.g. a plan pasted without EXPLAIN
  // ANALYZE's own execution summary) — can't judge "dominates," so this
  // rule stays silent rather than guessing what it's being compared to.
  if (executionMs === undefined || !Number.isFinite(executionMs)) return []

  const ratio = executionMs > 0 ? planningMs / executionMs : Infinity
  if (ratio < DOMINANCE_RATIO_THRESHOLD) return []

  const ratioText = Number.isFinite(ratio) ? `${formatNumber(Math.round(ratio))}x` : "far longer than"

  return [
    {
      ruleId: "planning-overhead",
      severity: ratio >= 10 ? "warning" : "info",
      shortText: `Planning took ${formatNumber(planningMs)} ms — ${ratioText} the ${formatNumber(executionMs)} ms execution itself took.`,
      longText:
        `This query spent ${formatNumber(planningMs)} ms planning, compared to ${formatNumber(executionMs)} ms actually ` +
        `executing — planning time ${Number.isFinite(ratio) ? `is ${ratioText} execution time` : "dominates"}. For a one-off ` +
        `query this may not matter much, but for a query run frequently (planning cost is paid on every single execution ` +
        `unless it's a cached/prepared statement), this overhead adds up. Whether that's the case for THIS query isn't ` +
        `determinable from a single pasted plan.`,
    },
  ]
}
