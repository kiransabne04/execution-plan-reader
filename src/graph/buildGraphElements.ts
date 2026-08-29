// Episode 6 — pure PlanNode-tree -> React Flow nodes/edges conversion,
// deliberately framework-light (plain objects matching @xyflow/react's Node/
// Edge shape) so this is fully unit-testable without mounting React Flow.
// See .claude/skills/graph-visualization/SKILL.md.

import type { Edge, Node } from "@xyflow/react"
import dagre from "@dagrejs/dagre"
import type { PlanNode } from "../parsers/normalize"
import type { NodeMatchStatus } from "../comparison/matchNodes"
import { buildEdgeWidthScale, buildMetricScale, pickMetricValue, type MetricKey } from "./encoding"

/**
 * Episode 14, Story 14.2 — one node's comparison-view overlay, computed by
 * `PlanComparisonView` from a `matchNodes` result and passed in per-render
 * via `BuildGraphElementsOptions.comparisonOverlays`. `counterpart` is only
 * ever set for `status: "changed"` — the matched node's shape in the OTHER
 * plan, so the card can show the concrete delta ("Seq Scan -> Index Scan")
 * without either pane needing to know about the other plan's full tree.
 */
export interface ComparisonOverlay {
  status: NodeMatchStatus
  counterpart?: { rawOperatorLabel: string; estimatedCost?: number; actualTimeMs?: number }
}

export interface PlanNodeData extends Record<string, unknown> {
  kind: "plan"
  planNode: PlanNode
  width: number
  height: number
  color: string
  /** Estimate-vs-actual mismatch — reuses the rule engine's own bad-row-estimate
   * finding rather than recomputing a second, possibly-inconsistent threshold. */
  hasMismatch: boolean
  loopCount?: number
  comparisonOverlay?: ComparisonOverlay
  /** Attached by PlanGraph after this otherwise-plain, testable conversion —
   * lets the card open its own detail panel from a keyboard Enter/Space,
   * not just a mouse click handled at the ReactFlow container level. */
  onOpen?: () => void
}

export interface CollapsedGroupNodeData extends Record<string, unknown> {
  kind: "collapsed-group"
  hiddenNodeCount: number
  parentPlanNodeId: string
}

export type PlanGraphNode = Node<PlanNodeData, "planNode"> | Node<CollapsedGroupNodeData, "collapsedGroup">

export interface PlanEdgeData extends Record<string, unknown> {
  rows: number
  strokeWidth: number
  /** True for every edge into a node beyond its first — see the
   * multi-parent/shared-reference handling below. */
  isSharedReference: boolean
}

export type PlanGraphEdge = Edge<PlanEdgeData>

export interface BuildGraphElementsOptions {
  metric?: MetricKey
  collapsedIds?: Set<string>
  /** Episode 14, Story 14.2 — keyed by this tree's own `PlanNode.id`. Absent
   * for a plain single-plan render (the common case); present when this
   * tree is one side of a comparison view. */
  comparisonOverlays?: Map<string, ComparisonOverlay>
}

export interface BuildGraphElementsResult {
  nodes: PlanGraphNode[]
  edges: PlanGraphEdge[]
}

/** Exported for Episode 15's AccessiblePlanList, which renders its own
 * "N hidden" collapsed-group row from the same PlanNode tree rather than
 * re-deriving descendant counts from buildGraphElements' React-Flow-shaped
 * output — single source of truth for what "collapsed" means. */
export function countDescendants(node: PlanNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

function edgeId(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`
}

/**
 * Converts a PlanNode tree (really a DAG — Snowflake's multi-parent
 * operators are the same object reachable via more than one parent) into
 * React Flow elements. A node reachable from multiple parents is placed
 * exactly ONCE; every additional incoming edge is marked
 * `isSharedReference: true` for distinct (dashed) styling — linked, never
 * duplicated into a second copy of its subtree.
 */
export function buildGraphElements(root: PlanNode, options: BuildGraphElementsOptions = {}): BuildGraphElementsResult {
  const metric = options.metric ?? "actualTimeMs"
  const collapsedIds = options.collapsedIds ?? new Set<string>()
  const comparisonOverlays = options.comparisonOverlays

  const metricScale = buildMetricScale(root, metric)
  const edgeScale = buildEdgeWidthScale(root)

  const nodes: PlanGraphNode[] = []
  const edges: PlanGraphEdge[] = []
  const placed = new Set<string>()

  const visit = (node: PlanNode, parentId: string | null): void => {
    const alreadyPlaced = placed.has(node.id)

    if (!alreadyPlaced) {
      placed.add(node.id)
      const value = pickMetricValue(node, metric)
      const { width, height } = metricScale.sizeFor(value)
      nodes.push({
        id: node.id,
        type: "planNode",
        position: { x: 0, y: 0 }, // overwritten by dagre below
        width,
        height,
        data: {
          kind: "plan",
          planNode: node,
          width,
          height,
          color: metricScale.colorFor(value),
          hasMismatch: node.warnings.some((w) => w.ruleId === "bad-row-estimate"),
          loopCount: node.loops !== undefined && node.loops > 1 ? node.loops : undefined,
          comparisonOverlay: comparisonOverlays?.get(node.id),
        },
      })
    }

    if (parentId !== null) {
      const rows = Math.max(0, node.actualRows ?? node.estimatedRows ?? 0)
      const strokeWidth = edgeScale.widthFor(rows)
      edges.push({
        id: edgeId(parentId, node.id),
        source: parentId,
        target: node.id,
        data: { rows, strokeWidth, isSharedReference: alreadyPlaced },
        // Dashed = a linking indicator for a shared (multi-parent) reference,
        // never a duplicated subtree — see the module comment above.
        style: { strokeWidth, strokeDasharray: alreadyPlaced ? "6 4" : undefined },
      })
    }

    if (alreadyPlaced) return // never re-walk/duplicate an already-placed subtree

    if (collapsedIds.has(node.id) && node.children.length > 0) {
      const hiddenNodeCount = countDescendants(node)
      const groupId = `${node.id}::collapsed`
      nodes.push({
        id: groupId,
        type: "collapsedGroup",
        position: { x: 0, y: 0 },
        width: 160,
        height: 48,
        data: { kind: "collapsed-group", hiddenNodeCount, parentPlanNodeId: node.id },
      })
      edges.push({
        id: edgeId(node.id, groupId),
        source: node.id,
        target: groupId,
        data: { rows: 0, strokeWidth: EDGE_MIN_WIDTH, isSharedReference: false },
        style: { strokeWidth: EDGE_MIN_WIDTH, strokeDasharray: "2 3" },
      })
      return
    }

    node.children.forEach((child) => visit(child, node.id))
  }

  visit(root, null)

  return { nodes: applyDagreLayout(nodes, edges), edges }
}

const EDGE_MIN_WIDTH = 1.5

function applyDagreLayout(nodes: PlanGraphNode[], edges: PlanGraphEdge[]): PlanGraphNode[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 56 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width ?? 160, height: node.height ?? 56 })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    const width = node.width ?? 160
    const height = node.height ?? 56
    // dagre positions by center; React Flow positions by top-left corner.
    return { ...node, position: { x: pos.x - width / 2, y: pos.y - height / 2 } }
  })
}
