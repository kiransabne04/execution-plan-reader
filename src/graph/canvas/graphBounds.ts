// Episode 15, Story 15.1 originally (inside CanvasPlanGraph.tsx); moved
// here in Episode 18, Story 18.11 once PNG export (exportPng.ts) needed
// the exact same world-space bounding-box computation CanvasPlanGraph's
// own fit-to-view already used — one implementation, not a second one
// re-derived for export.

import type { PlanGraphNode } from "../buildGraphElements"

export interface GraphBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function computeBounds(nodes: PlanGraphNode[]): GraphBounds | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const width = node.width ?? 160
    const height = node.height ?? 56
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + width)
    maxY = Math.max(maxY, node.position.y + height)
  }
  return { minX, minY, maxX, maxY }
}
