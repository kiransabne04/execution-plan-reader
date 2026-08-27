// Hover tooltip content for a plan-node card — per the graph-visualization
// skill, the hover tooltip and the click detail panel are deliberately two
// separate components ("Tooltip: lightweight, a handful of key stats, fast
// to render"). Predicates/seek conditions are the specific thing this
// surfaces without a click, since the full detail panel already renders
// them as their own full-width block (Story 6.2) once a node is opened.

import type { PlanNode } from "../parsers/normalize"

/** Undefined when the node has no predicate/seek/join condition at all —
 * callers must render no tooltip in that case, not an empty one. */
export function buildNodeTooltip(node: PlanNode): string | undefined {
  const lines: string[] = []
  if (node.predicate?.filter) lines.push(`Filter: ${node.predicate.filter}`)
  if (node.predicate?.indexCondition) lines.push(`Seek: ${node.predicate.indexCondition}`)
  if (node.predicate?.joinCondition) lines.push(`Join: ${node.predicate.joinCondition}`)
  return lines.length > 0 ? lines.join("\n") : undefined
}
