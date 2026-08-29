// Episode 14 Story 14.2 — turns a matchNodes() result into the plain-
// language headline the comparison view's summary strip shows before the
// user reads the graph in detail (the story's own example: "3 nodes
// changed, 1 added, 0 removed — total estimated cost decreased by 40%").

import type { PlanNode } from "../parsers/normalize"
import { summarizeMatches, type NodeMatch } from "./matchNodes"

export interface ComparisonSummaryText {
  /** e.g. "3 nodes changed, 1 added, 0 removed — total estimated cost decreased by 40%." */
  headline: string
  /** Set when the match ratio is low — the UI should warn these may not be
   * comparable plans rather than presenting the diff as reliable (Story
   * 14.1's "genuinely different queries" edge case). */
  lowConfidenceWarning?: string
}

const LOW_CONFIDENCE_WARNING =
  "These plans share few matching nodes — they may not be comparable (e.g. different queries entirely). Treat this diff with caution."

/**
 * Percent change in the root node's `estimatedCost`, the one figure that's
 * cumulative up the tree (a node's own cost already includes its subtree),
 * so the root IS the plan's total. Returns `undefined` — never a fabricated
 * number — when either side lacks a cost figure at all: a genuine cross-
 * engine gap (Snowflake has no comparable cost-unit concept, see
 * docs/10-node-stats-field-catalog.md), not something to paper over.
 */
function formatCostDelta(planA: PlanNode, planB: PlanNode): string | undefined {
  const costA = planA.estimatedCost
  const costB = planB.estimatedCost
  if (costA === undefined || costB === undefined || costA <= 0) return undefined
  const percentChange = Math.round(((costB - costA) / costA) * 100)
  if (percentChange === 0) return "total estimated cost is about the same"
  const direction = percentChange < 0 ? "decreased" : "increased"
  return `total estimated cost ${direction} by ${Math.abs(percentChange)}%`
}

export function buildComparisonSummary(matches: NodeMatch[], planA: PlanNode, planB: PlanNode): ComparisonSummaryText {
  const stats = summarizeMatches(matches)
  const countsText = `${stats.changedCount} node${stats.changedCount === 1 ? "" : "s"} changed, ${stats.addedCount} added, ${stats.removedCount} removed`
  const costDelta = formatCostDelta(planA, planB)
  return {
    headline: costDelta ? `${countsText} — ${costDelta}.` : `${countsText}.`,
    lowConfidenceWarning: stats.lowConfidence ? LOW_CONFIDENCE_WARNING : undefined,
  }
}
