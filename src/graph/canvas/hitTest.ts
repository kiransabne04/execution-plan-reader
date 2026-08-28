// Episode 15, Story 15.1 — manual hit-testing for the canvas rendering
// path. Canvas has no DOM click events, so this is the entire interaction
// surface: a pointer coordinate in, the node under it (if any) out. See
// .claude/skills/canvas-rendering-performance/SKILL.md rule 2.

import type { PlanGraphNode } from "../buildGraphElements"

export interface Point {
  x: number
  y: number
}

/** Linear scan over dagre's own layout output (position/width/height are
 * already on each node — see buildGraphElements.ts). Acceptable up to the
 * "low thousands of nodes" the skill calls out; a spatial index (quadtree)
 * is explicitly not warranted without benchmark evidence it's needed.
 * `point` must already be in world/graph coordinates — the caller inverts
 * the current pan/zoom transform before calling this, not this function's
 * concern (keeps it pure and independently testable at any transform). */
export function findNodeAtPoint(nodes: PlanGraphNode[], point: Point): PlanGraphNode | undefined {
  // Later entries were drawn on top (buildGraphElements pushes parents
  // before children in traversal order, and siblings can overlap at
  // extreme zoom) — search from the end so an overlap resolves to whatever
  // visually renders on top, matching what the user actually sees.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    const width = node.width ?? 0
    const height = node.height ?? 0
    const left = node.position.x
    const top = node.position.y
    if (point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height) {
      return node
    }
  }
  return undefined
}
