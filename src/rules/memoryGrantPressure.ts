// SQL Server rule: memory-grant-pressure. The inverse case from
// `memoryGrantExcessive.ts`: the memory grant wasn't big enough, and the
// query had to spill to tempdb somewhere as a result.
//
// This file's own explicit instruction: do NOT trigger solely because
// "used ≈ granted." That comparison is a poor signal here on its own —
// when a query actually spills, `MaxUsedMemory` typically comes back
// close to the grant almost BY CONSTRUCTION (the excess that didn't fit
// went to disk, not into more memory usage), so "used is close to
// granted" is true for both a perfectly-sized healthy grant AND an
// undersized one that spilled. The only thing that actually distinguishes
// "undersized" from "well-sized" is REAL SPILL EVIDENCE somewhere in the
// tree — this rule correlates a genuinely modest grant with at least one
// node in the SAME query that actually spilled (per `spill.occurred`,
// engine-agnostic), rather than inferring insufficiency from the
// used/granted ratio alone.
//
// "Small grant" is scoped deliberately: if the grant were already large
// and the query STILL spilled, "give it more memory" is a much shakier
// recommendation (the data volume may simply be too large for any
// reasonable grant, or the real fix is elsewhere) — this rule only fires
// when the existing grant was modest enough that a bigger one is a
// plausible, low-risk next step.

import { collectNodes } from "../parsers/normalize"
import { formatBytesCompact } from "./format"
import type { Rule } from "./types"

/** At or below this many KB, a memory grant is judged "modest" — small
 * enough that recommending a larger one is a reasonable, low-risk
 * suggestion. 65,536 KB = 64 MB, a deliberately generous ceiling since the
 * story only asks this rule to avoid recommending more memory when the
 * existing grant was already substantial. */
export const MODEST_GRANT_KB_THRESHOLD = 65_536

export const memoryGrantPressure: Rule = (node, context) => {
  if (node.engine !== "sqlserver" || node.id !== context.rootId) return [] // whole-query fact, surfaced once

  const grantedKb = node.memoryGrant?.grantedKb
  if (grantedKb === undefined || !Number.isFinite(grantedKb) || grantedKb <= 0) return []
  if (grantedKb > MODEST_GRANT_KB_THRESHOLD) return []

  // Real correlated evidence, not an inference from used≈granted alone —
  // walking this node's own subtree (it IS the root, confirmed above) is
  // the same pattern parallelWorkerShortfall.ts's SQL Server check already
  // uses for its own root-level, whole-tree correlation.
  const spillingNodes = collectNodes(node).filter((n) => n.spill?.occurred)
  if (spillingNodes.length === 0) return []

  const grantedText = formatBytesCompact(grantedKb * 1024)
  const spillCountText = spillingNodes.length === 1 ? "one operator" : `${spillingNodes.length} operators`
  const operatorNames = [...new Set(spillingNodes.map((n) => n.rawOperatorLabel))].join(", ")

  return [
    {
      ruleId: "memory-grant-pressure",
      severity: "warning",
      shortText: `Modest memory grant (${grantedText}) alongside a real tempdb spill — the grant may not have been enough.`,
      longText:
        `This query's memory grant was ${grantedText} — on the modest side — and ${spillCountText} (${operatorNames}) ` +
        `actually spilled to tempdb. That combination is worth noticing: a comparison of used-vs-granted memory alone ` +
        `wouldn't reliably show this, since a query that spills tends to report memory usage close to its grant ` +
        `regardless of whether the grant was well-sized or not — the excess that didn't fit went to disk instead of ` +
        `showing up as more memory used. The real evidence here is the spill itself. A larger memory grant for this ` +
        `query is a reasonable thing to try given how modest this one was, though it isn't guaranteed to eliminate ` +
        `the spill if the underlying data volume is larger than expected — see this plan's own spill finding(s) for ` +
        `the specific operator(s) involved.`,
      provenance: {
        threshold: `grantedKb ≤ ${formatBytesCompact(MODEST_GRANT_KB_THRESHOLD * 1024)} AND at least one node with spill.occurred`,
        computed: `${grantedText} granted, ${spillCountText} spilled`,
      },
    },
  ]
}
