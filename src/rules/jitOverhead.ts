// Episode 24, Story 24.8 — JIT compilation overhead forming a substantial
// fraction of total execution time. Root-node-only (see `JitInfo`'s own
// doc comment, normalize.ts, for why JIT is a whole-query fact).
//
// Do NOT state that JIT should always be disabled (this story's own
// explicit instruction) — JIT's whole premise is that compiling
// expressions to native code pays off when a query (or its expressions)
// runs enough times to amortize the compile cost; a SINGLE EXPLAIN ANALYZE
// run can't tell you whether that's true for how this query actually gets
// used. This rule discloses the overhead as observed in this one run,
// never a verdict on the `jit`/`jit_above_cost` setting.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many ms of actual JIT time, the overhead is too small in
 * absolute terms to matter even if it's a high percentage of a very fast
 * query. */
export const MIN_JIT_MS_THRESHOLD = 5

export const JIT_OVERHEAD_RATIO_THRESHOLD = 0.2

export const jitOverhead: Rule = (node, context) => {
  if (node.id !== context.rootId) return []
  const jitTotalMs = node.jit?.totalMs
  if (jitTotalMs === undefined || !Number.isFinite(jitTotalMs) || jitTotalMs < MIN_JIT_MS_THRESHOLD) return []

  const executionMs = node.executionTimeMs ?? node.actualTimeMs
  if (executionMs === undefined || !Number.isFinite(executionMs) || executionMs <= 0) return []

  const ratio = jitTotalMs / executionMs
  if (ratio < JIT_OVERHEAD_RATIO_THRESHOLD) return []

  const percentText = `${Math.round(ratio * 100)}%`

  return [
    {
      ruleId: "jit-overhead",
      severity: ratio >= 0.5 ? "warning" : "info",
      shortText: `JIT compilation took ${formatNumber(jitTotalMs)} ms — ${percentText} of the ${formatNumber(executionMs)} ms execution.`,
      longText:
        `JIT compilation for this query took ${formatNumber(jitTotalMs)} ms out of ${formatNumber(executionMs)} ms total ` +
        `execution time (${percentText}). JIT trades an up-front compile cost for faster expression evaluation — that ` +
        `trade pays off when a query (or its expressions) runs often enough to amortize the compile cost, and doesn't ` +
        `when it's run once. This single run can't tell you which is true for how this query is actually used, so this ` +
        `isn't a recommendation to disable JIT — if this cost recurs on every execution of a query like this one, it's ` +
        `worth checking whether \`jit_above_cost\`/related settings are tuned for this workload.`,
    },
  ]
}
