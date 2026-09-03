// Episode 24, Story 24.9 — Materialize re-scan cost. Materialize itself is
// not inherently bad (this story's own explicit instruction) — caching an
// inner subtree's output so a Nested Loop's repeated inner-side scans hit
// memory instead of re-running the whole subtree is usually a genuine
// optimization. This rule only fires when ALL THREE of the story's own
// conditions hold together: many loops (the cache is actually being
// reused a lot), a large intermediate result (there's real volume being
// held/re-scanned), and a meaningful runtime contribution (it's actually
// costing real time, not a cheap no-op).

import { formatNumber } from "./format"
import type { Rule } from "./types"

export const MIN_LOOPS_THRESHOLD = 10
export const MIN_ROWS_THRESHOLD = 1_000
export const MIN_TOTAL_TIME_MS_THRESHOLD = 50

export const materializeRepeated: Rule = (node) => {
  if (node.operatorType !== "materialize") return []
  const loops = node.loops
  const rows = node.actualRows
  const timeMs = node.actualTimeMs
  if (loops === undefined || rows === undefined || timeMs === undefined) return []
  if (loops < MIN_LOOPS_THRESHOLD || rows < MIN_ROWS_THRESHOLD) return []

  const totalTimeMs = timeMs * loops
  if (totalTimeMs < MIN_TOTAL_TIME_MS_THRESHOLD) return []

  return [
    {
      ruleId: "materialize-repeated",
      severity: totalTimeMs >= 500 ? "warning" : "info",
      shortText: `Materialize re-scanned ${formatNumber(rows)} rows across ${formatNumber(loops)} loops (≈${formatNumber(Math.round(totalTimeMs))} ms total).`,
      longText:
        `This Materialize operation cached ${formatNumber(rows)} rows and was re-scanned ${formatNumber(loops)} times, ` +
        `contributing roughly ${formatNumber(Math.round(totalTimeMs))} ms in total across every re-scan. Materialize ` +
        `itself is not inherently bad — caching a repeatedly-scanned subtree's output is usually a genuine optimization ` +
        `over re-running that subtree from scratch each time. This is flagged because the combination of a large cached ` +
        `set, a high re-scan count, and a real time contribution is worth a closer look at whether the cached set could ` +
        `be smaller (a more selective condition on the materialized subtree) or the outer loop count reduced.`,
    },
  ]
}
