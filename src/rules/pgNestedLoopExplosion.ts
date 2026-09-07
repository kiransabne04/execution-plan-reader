// Episode 25, Story 25.2 — nested-loop explosion. `high-loop-count`
// (Episode 5) already flags loops×per-loop-time generically, engine-
// agnostic, on ANY operator. This rule is deliberately narrower and
// Postgres-specific: it looks at a Nested Loop join's own two children —
// a large OUTER row count driving a large number of INNER-side executions,
// each doing meaningful work — and phrases the finding in terms of that
// join partnership (outer rows × inner loops × inner work) rather than a
// generic "this operator loops a lot."
//
// Postgres's own JSON output has no per-child "Outer"/"Inner" tag
// preserved on normalized children (`Parent Relationship` is consumed by
// the parser only to detect InitPlan/SubPlan, then discarded — see
// `parseJsonPlan.ts`) — outer/inner is inferred from array position, which
// Postgres emits in a stable, verified order: `Plans[0]` is always the
// outer child, `Plans[1]` the inner (confirmed against this repo's own
// `rule-high-loop-count.json` fixture, itself a Nested Loop).
//
// Story 25.3 — repeated inner scan: folded into this SAME rule/ruleId
// rather than a second one, since it's describing the same join's same
// inner child from a different angle (an approximate total-repeated-work
// figure, and whether that work is individually cheap-but-frequent or
// genuinely expensive-and-repeated) — a separate rule would just restate
// this one under a new name. The "loops × per-loop time" arithmetic itself
// is `loopWork.ts`'s `computeCumulativeLoopWork`, shared with
// `high-loop-count` — one formula, not two independently-computed copies.

import { formatNumber } from "./format"
import { computeCumulativeLoopWork } from "./loopWork"
import type { Rule } from "./types"

/** Below this many outer rows, even a high inner loop count isn't the
 * "explosion" pattern this rule targets — just an ordinary small join. */
export const OUTER_ROWS_THRESHOLD = 10_000

/** Below this many inner-side loops, the join isn't repeating enough to
 * matter — independent of the outer-rows floor above (a future tweak to
 * one shouldn't accidentally make the other the only thing preventing a
 * false positive, the same independence the story's own healthy example
 * relies on). */
export const INNER_LOOPS_THRESHOLD = 10_000

/** Below this cumulative inner-side time, the repeated work is too cheap
 * in aggregate to be worth flagging — this is the floor that, on its own,
 * already excludes the story's own healthy case (outer 5, loops 5, 0.4ms
 * total: 5 loops at a trivial per-loop cost never reaches this). */
export const CUMULATIVE_INNER_MS_THRESHOLD = 1_000

/** Above this cumulative inner-side time, the finding escalates from
 * `warning` to `critical`. */
export const LARGE_CUMULATIVE_INNER_MS_THRESHOLD = 10_000

/** Below this per-loop time, each individual inner execution is cheap —
 * the finding is framed as "too many cheap executions" rather than "a
 * genuinely expensive child repeated," Story 25.3's own distinction. */
export const CHEAP_PER_LOOP_MS_THRESHOLD = 0.5

export const pgNestedLoopExplosion: Rule = (node) => {
  if (node.engine !== "postgres" || node.operatorType !== "nested_loop_join") return []
  if (node.children.length < 2) return [] // no inner/outer partnership to compare

  const [outer, inner] = node.children
  const outerRows = outer.actualRows
  const innerLoops = inner.loops
  const innerPerLoopMs = inner.actualTimeMs

  if (outerRows === undefined || innerLoops === undefined || innerPerLoopMs === undefined) return []
  if (!Number.isFinite(outerRows) || !Number.isFinite(innerLoops) || !Number.isFinite(innerPerLoopMs)) return []
  if (outerRows < OUTER_ROWS_THRESHOLD || innerLoops < INNER_LOOPS_THRESHOLD) return []

  // Shared with `high-loop-count` (loopWork.ts) — same "loops × per-loop
  // time" formula, one implementation, not two that could quietly drift.
  const cumulativeInnerMs = computeCumulativeLoopWork(innerLoops, innerPerLoopMs)
  if (cumulativeInnerMs === undefined || cumulativeInnerMs < CUMULATIVE_INNER_MS_THRESHOLD) return []

  const severity = cumulativeInnerMs >= LARGE_CUMULATIVE_INNER_MS_THRESHOLD ? "critical" : "warning"
  const totalText = `${formatNumber(Math.round(cumulativeInnerMs))}ms`

  // Story 25.3's differentiation: is this cheap-per-loop-but-too-frequent,
  // or genuinely-expensive-and-repeated? Both are "explosion," but the fix
  // differs — cheap-per-loop points at reducing the OUTER row count (fewer
  // iterations); expensive-per-loop points at making the INNER side itself
  // cheaper. No specific fix (e.g. an index) is named without this rule
  // having actual evidence for it — see the "No index is recommended"
  // note below.
  // Story's own explicit requirement: explain WHY a nested loop gets
  // expensive at this scale (its cost is outer-row-count × per-loop inner
  // cost, so either factor alone growing large multiplies the total), and
  // that the join algorithm itself isn't the problem — a nested loop over a
  // small outer side is often the cheapest possible join. No index is
  // recommended here: this rule only has timing/loop data, not index
  // evidence — that's `missing-index-opportunity`'s job, when it actually
  // has something to point at.
  const repeatedWorkNote =
    innerPerLoopMs < CHEAP_PER_LOOP_MS_THRESHOLD
      ? `Each inner execution is individually cheap (~${innerPerLoopMs.toFixed(3)}ms) — the cost here is purely the ` +
        `sheer NUMBER of times it runs, not any one execution being slow. Reducing the outer row count (a more ` +
        `selective condition earlier in the plan) is usually the more effective fix than making the inner side itself ` +
        `faster.`
      : `Each inner execution does meaningful work on its own (~${innerPerLoopMs.toFixed(2)}ms) — this is a genuinely ` +
        `expensive child being repeated, not just a cheap operation run too many times. Making the inner side itself ` +
        `cheaper usually helps more here than reducing the outer row count alone — worth looking at what's making ` +
        `that child slow before deciding on a fix.`

  return [
    {
      ruleId: "nested-loop-explosion",
      severity,
      shortText: `Nested Loop: outer side produced ${formatNumber(outerRows)} rows, inner side ran ${formatNumber(innerLoops)} times (≈${totalText} total).`,
      longText:
        `This Nested Loop's outer side (${outer.rawOperatorLabel}) produced ${formatNumber(outerRows)} rows, and its ` +
        `inner side (${inner.rawOperatorLabel}) ran once per outer row. The inner side averaged approximately ` +
        `${innerPerLoopMs.toFixed(3)}ms per execution and ran ${formatNumber(innerLoops)} times, representing ` +
        `roughly ${totalText} of repeated work — an estimate, not a figure Postgres measures and reports directly: ` +
        `per-loop time is already an average across every loop, which may not all have cost the same individually. ` +
        `A nested loop's total cost is roughly outer rows × inner per-loop cost, so it scales up fast once both ` +
        `sides are large — the join algorithm itself isn't inherently bad, it's just a poor fit once the outer side ` +
        `is this big and the inner side isn't free. ${repeatedWorkNote}`,
      provenance: {
        threshold: `outer rows ≥ ${formatNumber(OUTER_ROWS_THRESHOLD)} AND inner loops ≥ ${formatNumber(INNER_LOOPS_THRESHOLD)} AND cumulative inner time ≥ ${formatNumber(CUMULATIVE_INNER_MS_THRESHOLD)} ms`,
        computed: totalText,
      },
    },
  ]
}
