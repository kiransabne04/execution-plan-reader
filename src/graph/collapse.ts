// Episode 6 edge case: very large plans must not freeze the browser tab.
// Rather than true virtualization, subtrees that contribute negligible
// cost are collapsed by default — their descendants are simply left out of
// the rendered node/edge arrays entirely (both the React Flow path AND
// Episode 15's canvas path consume the same collapsedIds — see
// PlanGraph.tsx, CanvasPlanGraph.tsx, AccessiblePlanList.tsx). Collapse
// state is computed here as pure data; where it *lives* (so the user can
// expand it back) is local component state keyed by node id, never the
// PlanNode model itself — see .claude/skills/graph-visualization/SKILL.md.

import type { PlanNode } from "../parsers/normalize"
import { pickMetricValue, type MetricKey } from "./encoding"

/** Only auto-collapse at all once the plan is large enough that rendering
 * everything is the actual risk — small/medium plans always render fully
 * expanded regardless of how "small" any one subtree's cost share is.
 *
 * Episode 15 revision: originally 500 (the DOM/SVG freeze risk point this
 * threshold was built to protect against). Now set below
 * CANVAS_NODE_COUNT_THRESHOLD (PlanGraph.tsx) so DOM/SVG mode — which now
 * only ever renders plans up to that canvas threshold, never truly huge
 * ones — still gets real default-collapse protection for its own
 * mid-size/large range, rather than collapse's only-ever-reachable window
 * being entirely inside canvas mode (where it still applies, but for
 * legibility/clutter reasons more than a hard freeze risk). */
export const COLLAPSE_NODE_COUNT_THRESHOLD = 150

/** A subtree contributing less than this share of the plan's total metric
 * is collapsed by default once the plan is large. Tunable constant, not
 * hardcoded per engine. */
export const COLLAPSE_SUBTREE_PERCENT_THRESHOLD = 1

function subtreeTotal(node: PlanNode, metric: MetricKey, memo: Map<string, number>): number {
  const cached = memo.get(node.id)
  if (cached !== undefined) return cached
  const total = pickMetricValue(node, metric) + node.children.reduce((sum, c) => sum + subtreeTotal(c, metric, memo), 0)
  memo.set(node.id, total)
  return total
}

/** Returns the set of node ids that should start collapsed — each is the
 * root of a hidden subtree. Never includes the plan root itself. */
export function computeDefaultCollapsedIds(
  root: PlanNode,
  allNodes: PlanNode[],
  metric: MetricKey = "actualTimeMs",
): Set<string> {
  if (allNodes.length <= COLLAPSE_NODE_COUNT_THRESHOLD) return new Set()

  const memo = new Map<string, number>()
  const grandTotal = subtreeTotal(root, metric, memo)
  const collapsed = new Set<string>()

  const walk = (node: PlanNode, isRoot: boolean) => {
    if (!isRoot) {
      const share = grandTotal > 0 ? (subtreeTotal(node, metric, memo) / grandTotal) * 100 : 0
      if (share < COLLAPSE_SUBTREE_PERCENT_THRESHOLD && node.children.length > 0) {
        collapsed.add(node.id)
        return // don't also mark descendants — one collapse boundary is enough
      }
    }
    node.children.forEach((child) => walk(child, false))
  }

  walk(root, true)
  return collapsed
}

/** Story 13.1: when the "All findings" list navigates to a node that's
 * currently hidden inside a collapsed subtree, this returns the collapsed
 * ancestor ids (from `collapsedIds`) standing between the root and the
 * target — the caller removes them from its collapsed set so the target
 * becomes visible in the canvas. Returns an empty set if the target isn't
 * behind any collapse boundary (already visible, or not found at all). */
export function findCollapsedAncestors(root: PlanNode, targetId: string, collapsedIds: Set<string>): Set<string> {
  const result = new Set<string>()

  const walk = (node: PlanNode, ancestorChain: string[]): boolean => {
    if (node.id === targetId) {
      ancestorChain.filter((id) => collapsedIds.has(id)).forEach((id) => result.add(id))
      return true
    }
    return node.children.some((child) => walk(child, [...ancestorChain, node.id]))
  }

  walk(root, [])
  return result
}
