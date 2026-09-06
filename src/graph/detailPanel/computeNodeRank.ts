// Episode 25 — Design review (downloaded "expert overlay details" PNG),
// spec §1f: "this node's rank among all nodes" — one of the Expert-only
// header chips ("3rd slowest of 7"). Ranks by whichever real per-node
// figure `computeContributionPercent.ts` already uses as its own value
// (actualTimeMs, falling back to estimatedCost — the same fallback order,
// so the rank and the percentage chip next to it are always talking about
// the same underlying number) — never a second, different metric that
// could rank a node differently than its own contribution percentage says.

import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"

function comparableValue(node: PlanNode): number | undefined {
  const value = node.actualTimeMs ?? node.estimatedCost
  return value !== undefined && Number.isFinite(value) ? value : undefined
}

/** `undefined` when this node (or fewer than 2 comparable nodes overall)
 * has no comparable figure to rank — an honest "not available", never a
 * rank computed against a metric the node doesn't actually report. */
export function computeNodeRank(node: PlanNode, context: PlanContext): { rank: number; total: number } | undefined {
  const ranked = context.allNodes
    .map((n) => ({ id: n.id, value: comparableValue(n) }))
    .filter((n): n is { id: string; value: number } => n.value !== undefined)
    .sort((a, b) => b.value - a.value)

  if (ranked.length < 2) return undefined
  const index = ranked.findIndex((n) => n.id === node.id)
  if (index === -1) return undefined
  return { rank: index + 1, total: ranked.length }
}

const ORDINAL_SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" }

/** "1st"/"2nd"/"3rd"/"4th"... — English ordinal suffix, the exact wording
 * the mock's own "3rd slowest of 7" chip uses. */
export function formatOrdinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${ORDINAL_SUFFIX[n % 10] ?? "th"}`
}
