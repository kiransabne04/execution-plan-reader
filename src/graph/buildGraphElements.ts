// Episode 6 — pure PlanNode-tree -> React Flow nodes/edges conversion,
// deliberately framework-light (plain objects matching @xyflow/react's Node/
// Edge shape) so this is fully unit-testable without mounting React Flow.
// See .claude/skills/graph-visualization/SKILL.md.
//
// Episode 18, Story 18.4 — layout direction and edge DIRECTION both flip
// per docs/12-ui-redesign-spec.md §3/§4: edges are now drawn child -> parent
// (`source` = child, `target` = parent), not parent -> child. This is what
// makes dagre's `rankdir: "BT"` put leaves at the bottom (they have no
// incoming edges in this reversed model, so they're rank 0, and BT puts
// rank 0 at the bottom) with arrows pointing UP into the parent —
// "the way execution flows" (a scan executes and feeds its rows up into
// the join above it), not the tree-drawing convention the old parent->child
// direction happened to share the same top-to-bottom shape with by
// coincidence. Handles swap to match: `source` (outgoing, to this node's
// OWN parent) on Top, `target` (incoming, from this node's children) on
// Bottom — see PlanNodeCard.tsx.

import type { Edge, Node } from "@xyflow/react"
import dagre from "@dagrejs/dagre"
import type { PlanNode, Warning } from "../parsers/normalize"
import { relationIdentity, indexIdentity } from "../parsers/relationIdentity"
import type { NodeMatchStatus } from "../comparison/matchNodes"
import { buildEdgeWidthScale, buildMetricScale, pickMetricValue, type MetricKey } from "./encoding"
import { worstSeverity } from "./nodeSeverity"
import { operatorIconKey, type OperatorIconKey } from "./operatorIcons"

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
  /** Story 18.4 — this node's worst warning severity (`undefined` when it
   * has none), driving the severity-ring encoding. Deliberately reuses
   * `nodeSeverity.ts`'s `worstSeverity`, the same computation
   * `AccessiblePlanList.tsx` already had — one implementation, not a
   * third independent reimplementation. */
  severity?: Warning["severity"]
  /** Story 18.4 — the operator-icon CATEGORY (not the icon component
   * itself — this stays framework-light per the module comment above;
   * `PlanNodeCard` looks the component up from `operatorIcons.ts`). */
  iconKey: OperatorIconKey
  /** Story 18.4 — relation or index name, mono/ellipsised on the card.
   * `undefined` for operators with neither (Sort, Aggregate, …) — an
   * honest gap, not a fabricated label. Reuses the exact same per-engine
   * `attributes` reading Episode 14's node-matching algorithm already
   * solved (src/parsers/relationIdentity.ts) — not re-derived a third way. */
  subtitle?: string
  /** Story 18.4 — how many target handles (incoming, from this node's own
   * children) this card needs to render along its bottom edge, and at
   * which offsets — see `computeHandleOffsetPercent`. 0 for a leaf. */
  childCount: number
  /** Attached by PlanGraph after this otherwise-plain, testable conversion —
   * lets the card open its own detail panel from a keyboard Enter/Space,
   * not just a mouse click handled at the ReactFlow container level. */
  onOpen?: () => void
  /** Story 18.8, spec §5 `1h`: "Non-matching nodes drop to 32% opacity
   * rather than unmounting" — so the plan's shape stays readable while
   * searching. `false` (not just "undefined = no search") whenever no
   * search is active at all, so every card renders at full opacity by
   * default. */
  isDimmed: boolean
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
  /** Story 18.4, spec §4: "two stroke colours only" — this edge sits on
   * the single heaviest child-to-parent path by `metric`, computed once
   * per render alongside node color/size (the same basis, so "the hot
   * path" and "the hottest-colored nodes" never disagree with each other). */
  isHotPath: boolean
  /** Story 18.4 — this edge's ordinal position among its TARGET's incoming
   * edges (0-indexed), for `computeHandleOffsetPercent`. `canvasDraw.ts`
   * reads this directly rather than parsing it back out of the DOM path's
   * `targetHandle` id string — same value, cheaper to consume. */
  targetChildIndex: number
}

export type PlanGraphEdge = Edge<PlanEdgeData>

export interface BuildGraphElementsOptions {
  metric?: MetricKey
  collapsedIds?: Set<string>
  /** Episode 14, Story 14.2 — keyed by this tree's own `PlanNode.id`. Absent
   * for a plain single-plan render (the common case); present when this
   * tree is one side of a comparison view. */
  comparisonOverlays?: Map<string, ComparisonOverlay>
  /** Story 18.8 — the current search/filter's matched node ids. `undefined`
   * (the default, no active search) dims nothing; an empty `Set` (a query
   * that matched zero nodes) dims everything. */
  matchedNodeIds?: Set<string>
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

/** Story 18.4 — target-handle id for the Nth (0-indexed) child feeding into
 * a parent's bottom edge. Exported so `PlanNodeCard.tsx` (which handle to
 * render) and `buildGraphElements.ts` (which handle an edge targets) agree
 * on the same id scheme without duplicating the string format. */
export function targetHandleId(index: number): string {
  return `target-${index}`
}

/**
 * Story 18.4, spec §4: "Multiple inputs enter the parent's bottom edge at
 * separate x offsets, not one shared point." Evenly spaced with margin on
 * both ends (never flush with the card's rounded corners) — e.g. count=1 ->
 * 50%; count=2 -> 33%/67%; count=3 -> 25%/50%/75%. Exported so
 * `PlanNodeCard.tsx` (DOM/SVG Handle positions) and `canvasDraw.ts` (hand-
 * drawn anchor points) compute the IDENTICAL x-offset — the same "one
 * encoding, two renderers" rule the canvas-rendering-performance skill
 * requires of every other visual signal.
 */
export function computeHandleOffsetPercent(index: number, count: number): number {
  if (count <= 1) return 50
  return ((index + 1) / (count + 1)) * 100
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
  const matchedNodeIds = options.matchedNodeIds

  const metricScale = buildMetricScale(root, metric)
  const edgeScale = buildEdgeWidthScale(root)
  const hotEdgeIds = computeHotPathEdgeIds(root, metric)

  const nodes: PlanGraphNode[] = []
  const edges: PlanGraphEdge[] = []
  const placed = new Set<string>()

  const visit = (node: PlanNode, parentId: string | null, childIndex: number): void => {
    const alreadyPlaced = placed.has(node.id)
    const collapsed = collapsedIds.has(node.id) && node.children.length > 0

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
          severity: worstSeverity(node),
          iconKey: operatorIconKey(node.operatorType),
          subtitle: relationIdentity(node) ?? indexIdentity(node),
          childCount: collapsed ? 1 : node.children.length,
          isDimmed: matchedNodeIds !== undefined && !matchedNodeIds.has(node.id),
        },
      })
    }

    if (parentId !== null) {
      const rows = Math.max(0, node.actualRows ?? node.estimatedRows ?? 0)
      const strokeWidth = edgeScale.widthFor(rows)
      // Reversed from the pre-Story-18.4 direction: source = THIS node
      // (child, bottom), target = its parent (top) — see this file's own
      // module comment for why.
      edges.push({
        id: edgeId(node.id, parentId),
        source: node.id,
        target: parentId,
        targetHandle: targetHandleId(childIndex),
        type: "smoothstep",
        pathOptions: { borderRadius: 8 },
        // React Flow wraps this value in `url(#...)` itself internally —
        // a bare id, not an already-wrapped url() string (passing the
        // latter double-wraps into an invalid `url(#url(#...))`
        // reference, silently rendering no marker at all — hit exactly
        // this during this story's own visual verification).
        markerEnd: hotEdgeIds.has(edgeId(node.id, parentId)) ? "pg-arrow-hot" : "pg-arrow-muted",
        data: {
          rows,
          strokeWidth,
          isSharedReference: alreadyPlaced,
          isHotPath: hotEdgeIds.has(edgeId(node.id, parentId)),
          targetChildIndex: childIndex,
        },
        // Dashed = a linking indicator for a shared (multi-parent) reference,
        // never a duplicated subtree — see the module comment above.
        style: {
          strokeWidth,
          strokeDasharray: alreadyPlaced ? "6 4" : undefined,
          stroke: hotEdgeIds.has(edgeId(node.id, parentId)) ? "var(--color-edge-hot)" : "var(--color-edge-muted)",
        },
      })
    }

    if (alreadyPlaced) return // never re-walk/duplicate an already-placed subtree

    if (collapsed) {
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
      // Same reversed direction as every other edge: the collapsed group
      // (standing in for hidden execution work below it) is the source,
      // node.id (which receives it) is the target — the single target
      // handle this node reserves for it (childCount: 1, set above).
      edges.push({
        id: edgeId(groupId, node.id),
        source: groupId,
        target: node.id,
        targetHandle: targetHandleId(0),
        type: "smoothstep",
        pathOptions: { borderRadius: 8 },
        markerEnd: "pg-arrow-muted", // never hot — hidden content's internal hotness is unknown until expanded
        data: { rows: 0, strokeWidth: EDGE_MIN_WIDTH, isSharedReference: false, isHotPath: false, targetChildIndex: 0 },
        style: { strokeWidth: EDGE_MIN_WIDTH, strokeDasharray: "2 3", stroke: "var(--color-edge-muted)" },
      })
      return
    }

    node.children.forEach((child, i) => visit(child, node.id, i))
  }

  visit(root, null, 0)

  return { nodes: applyDagreLayout(nodes, edges), edges }
}

const EDGE_MIN_WIDTH = 1.5

/**
 * Story 18.4, spec §4: "two stroke colours only... thickness carries row
 * volume, colour carries hot-path membership." The hot path is the single
 * continuous root-to-leaf trail through whichever child has the highest
 * `metric` value at each branching point — the same basis node fill/size
 * already uses (`pickMetricValue`), so "hot-colored node" and "on the hot
 * path" never disagree. Only ONE path is ever hot: a non-hottest child's
 * entire subtree is muted regardless of internal variation within it —
 * this names the single dominant cost trail, not every locally-expensive
 * node (that's what node fill color is already for).
 */
function computeHotPathEdgeIds(root: PlanNode, metric: MetricKey): Set<string> {
  const hot = new Set<string>()
  const walk = (node: PlanNode) => {
    if (node.children.length === 0) return
    let hottest = node.children[0]
    let hottestValue = pickMetricValue(hottest, metric)
    for (const child of node.children.slice(1)) {
      const value = pickMetricValue(child, metric)
      if (value > hottestValue) {
        hottest = child
        hottestValue = value
      }
    }
    hot.add(edgeId(hottest.id, node.id))
    walk(hottest)
  }
  walk(root)
  return hot
}

function applyDagreLayout(nodes: PlanGraphNode[], edges: PlanGraphEdge[]): PlanGraphNode[] {
  const g = new dagre.graphlib.Graph()
  // Story 18.4 — "BT" (bottom-to-top), paired with the now-reversed
  // child->parent edge direction above: leaves have no incoming edges in
  // this model, so they're dagre's rank 0, and BT puts rank 0 at the
  // bottom. Root (only incoming edges, from its children) ends up at the
  // opposite end — the top. See this file's own module comment.
  g.setGraph({ rankdir: "BT", nodesep: 32, ranksep: 56 })
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
