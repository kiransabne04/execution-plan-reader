// Shared number/time formatting for the node detail panel's stat rows
// (buildStatRows.ts's original "This node's numbers" table and Episode 25's
// buildExpertSections.ts grouped Expert tables both need the exact same
// locale/precision conventions — one copy, not two that could drift apart).

export const NOT_CAPTURED = "not captured in this plan"
export const NOT_APPLICABLE = "not applicable for this engine"

// Defensive final layer: whatever upstream check let a value through, a
// non-finite number must never surface as the literal text "NaN"/"Infinity".
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "—"
}

export function formatMs(value: number): string {
  return Number.isFinite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms` : "—"
}
