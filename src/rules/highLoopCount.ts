// MVP rule 4: nested loop join blowup — high loop count with high per-loop
// cost. Expressed generically on loops+actualTimeMs (both already
// normalized fields) rather than specifically gated on operatorType ===
// "nested_loop_join", since SQL Server's nested-loop inner side produces
// the same signal via ActualExecutions and the pattern is worth flagging
// regardless of which join wraps it.
//
// Required suppression: actualTimeMs is already a PER-LOOP average for
// Postgres (the engine itself reports `Actual Total Time` this way).
// SQL Server is genuinely different: `actualTimeMs` there
// (`RunTimeCountersPerThread`'s `ActualElapsedms`) is a RAW CUMULATED
// TOTAL — summed across threads only, never divided by `ActualExecutions`
// (see `parseShowplanXml.ts`'s own `actualTimeMs`/`actualTimePerExecutionMs`
// derivation) — so for a SQL Server node with `loops > 1` on a single
// thread (the common inner-side-of-a-nested-loop/repeated-Key-Lookup
// shape this rule exists to catch), treating `actualTimeMs` as "per loop"
// and then multiplying it BACK OUT by `loops` compounds a loops² inflation
// (confirmed by hand: a real ~600ms total across 1,200 executions was
// reported as "~600ms EACH — ~720,000ms total," 1,200x too high on both
// figures). Fixed by preferring `actualTimePerExecutionMs` (the parser's
// own correctly-divided figure — identical to `actualTimeMs` for Postgres,
// since Postgres's own value already is per-loop, so this is a strict
// superset fix with no behavior change there) for BOTH the "each" text and
// the total-work computation — the same "always use the per-execution
// field, never raw actualTimeMs, for an 'average' claim" discipline
// `keyLookupExplosion.ts` already established. The cross-thread cumulated
// case (SQL Server parallelism) still returns early below and is
// unaffected by this fix — a fundamentally different concern (worker
// fan-out, not loop repetition) this rule still doesn't attempt to
// describe. See .claude/skills/rule-engine-authoring/SKILL.md.

import { formatNumber } from "./format"
import { computeCumulativeLoopWork } from "./loopWork"
import type { Rule } from "./types"

export const LOOP_COUNT_THRESHOLD = 1_000
export const PER_LOOP_MS_THRESHOLD = 1
export const TOTAL_CONTRIBUTION_MS_THRESHOLD = 500

export const highLoopCount: Rule = (node) => {
  if (node.attributes["Actual Time Is Cumulated Across Threads"] === "true") return []

  const { loops, actualTimeMs, actualTimePerExecutionMs } = node
  const perLoopMs = actualTimePerExecutionMs ?? actualTimeMs
  if (loops === undefined || perLoopMs === undefined || !Number.isFinite(loops) || !Number.isFinite(perLoopMs)) {
    return []
  }
  if (loops <= LOOP_COUNT_THRESHOLD || perLoopMs <= PER_LOOP_MS_THRESHOLD) return []

  const totalMs = computeCumulativeLoopWork(loops, perLoopMs)
  if (totalMs === undefined || totalMs < TOTAL_CONTRIBUTION_MS_THRESHOLD) return []

  return [
    {
      ruleId: "high-loop-count",
      severity: "warning",
      shortText: `Runs ${formatNumber(loops)} times at ~${perLoopMs.toFixed(2)}ms each — ~${formatNumber(Math.round(totalMs))}ms total.`,
      longText:
        `This ${node.rawOperatorLabel} executes ${formatNumber(loops)} times — typically once per row from the ` +
        `outer side of a join — each taking about ${perLoopMs.toFixed(2)}ms, for roughly ` +
        `${formatNumber(Math.round(totalMs))}ms total. This is the classic nested-loop-join blowup pattern: cheap ` +
        `per iteration, expensive in aggregate. A different join algorithm, or an index that makes each iteration ` +
        `cheaper, usually helps.`,
      provenance: {
        threshold: `loops > ${formatNumber(LOOP_COUNT_THRESHOLD)}`,
        computed: formatNumber(loops),
        additionalConditions: [
          `per-loop time > ${PER_LOOP_MS_THRESHOLD} ms`,
          `total contribution ≥ ${TOTAL_CONTRIBUTION_MS_THRESHOLD} ms`,
        ],
      },
    },
  ]
}
