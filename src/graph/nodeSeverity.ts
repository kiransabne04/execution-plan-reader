// Shared "what's the worst warning on this node" helper. First built inside
// AccessiblePlanList.tsx (Episode 15, Story 15.2); extracted here in
// Episode 18 Story 18.4 once the DOM/SVG node card and canvas draw path
// both needed the exact same computation for the new severity-ring
// encoding (spec §3) — one implementation, not a third independent
// reimplementation.

import type { PlanNode, Warning } from "../parsers/normalize"

export const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }
export const SEVERITY_LABEL: Record<Warning["severity"], string> = { critical: "Critical", warning: "Warning", info: "Info" }

/** The single most severe warning on a node, or `undefined` when it has
 * none. Ties (multiple warnings at the same severity) resolve to whichever
 * appeared first — the rule engine already sorts `node.warnings`
 * critical -> warning -> info, so in practice this just reads `[0]`, but
 * doesn't assume that ordering is guaranteed to stay that way forever. */
export function worstSeverity(node: PlanNode): Warning["severity"] | undefined {
  if (node.warnings.length === 0) return undefined
  return node.warnings.reduce<Warning["severity"]>(
    (worst, w) => (SEVERITY_RANK[w.severity] < SEVERITY_RANK[worst] ? w.severity : worst),
    node.warnings[0].severity,
  )
}
