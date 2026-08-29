import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { buildGraphElements, computeHandleOffsetPercent, targetHandleId } from "../buildGraphElements"
import { collectNodes } from "../../parsers/normalize"
import { makeNode } from "../../rules/__tests__/testHelpers"
import { parseSnowflakeOperatorStats } from "../../parsers/snowflake"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

describe("buildGraphElements", () => {
  it("produces one React Flow node per PlanNode and one edge per parent-child link, for a strict tree", () => {
    const leaf1 = makeNode({ id: "leaf1", actualRows: 100 })
    const leaf2 = makeNode({ id: "leaf2", actualRows: 200 })
    const root = makeNode({ id: "root", actualRows: 300, children: [leaf1, leaf2] })
    const { nodes, edges } = buildGraphElements(root)
    expect(nodes).toHaveLength(3)
    expect(edges).toHaveLength(2)
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(["root", "leaf1", "leaf2"]))
  })

  it("renders a single-node plan cleanly with no edges and no crash", () => {
    const root = makeNode({ id: "solo" })
    const { nodes, edges } = buildGraphElements(root)
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    expect(nodes[0].position.x).not.toBeNaN()
    expect(nodes[0].position.y).not.toBeNaN()
  })

  it("assigns a zero-cost/zero-row node a valid, non-degenerate size (no division-by-zero)", () => {
    const root = makeNode({ id: "solo", actualRows: 0, actualTimeMs: 0, estimatedCost: 0 })
    const { nodes } = buildGraphElements(root)
    const [node] = nodes
    expect(node.width).toBeGreaterThan(0)
    expect(node.height).toBeGreaterThan(0)
    expect(node.data.color).toMatch(/^hsl\(/)
  })

  it("sets the mismatch flag only when the node carries a bad-row-estimate warning", () => {
    const flagged = makeNode({
      id: "flagged",
      warnings: [{ ruleId: "bad-row-estimate", severity: "warning", shortText: "x", longText: "y" }],
    })
    const clean = makeNode({ id: "clean" })
    const root = makeNode({ id: "root", children: [flagged, clean] })
    const { nodes } = buildGraphElements(root)
    const flaggedNode = nodes.find((n) => n.id === "flagged")!
    const cleanNode = nodes.find((n) => n.id === "clean")!
    expect(flaggedNode.data.kind === "plan" && flaggedNode.data.hasMismatch).toBe(true)
    expect(cleanNode.data.kind === "plan" && cleanNode.data.hasMismatch).toBe(false)
  })

  it("sets a loop badge count only when loops > 1", () => {
    const looped = makeNode({ id: "looped", loops: 950 })
    const single = makeNode({ id: "single", loops: 1 })
    const root = makeNode({ id: "root", children: [looped, single] })
    const { nodes } = buildGraphElements(root)
    const loopedNode = nodes.find((n) => n.id === "looped")!
    const singleNode = nodes.find((n) => n.id === "single")!
    expect(loopedNode.data.kind === "plan" && loopedNode.data.loopCount).toBe(950)
    expect(singleNode.data.kind === "plan" && singleNode.data.loopCount).toBeUndefined()
  })

  it("collapses a subtree into a single collapsed-group node instead of rendering its descendants", () => {
    const grandchild = makeNode({ id: "grandchild" })
    const child = makeNode({ id: "child", children: [grandchild] })
    const root = makeNode({ id: "root", children: [child] })
    const { nodes, edges } = buildGraphElements(root, { collapsedIds: new Set(["child"]) })
    expect(nodes.find((n) => n.id === "grandchild")).toBeUndefined()
    const groupNode = nodes.find((n) => n.id === "child::collapsed")
    expect(groupNode).toBeDefined()
    expect(groupNode!.data.kind === "collapsed-group" && groupNode!.data.hiddenNodeCount).toBe(1)
    // Story 18.4: edges are drawn child -> parent (source = the collapsed
    // group, standing in for hidden execution work below it; target = the
    // node that receives it) — reversed from the pre-18.4 direction.
    expect(edges.some((e) => e.source === "child::collapsed" && e.target === "child")).toBe(true)
  })

  it("renders a shared multi-parent reference (Snowflake DAG) exactly once, with a dashed linking edge for the repeat", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("snowflake", "multi-parent-with-clause.json"))
    const { nodes, edges } = buildGraphElements(root)

    // 5 distinct operators in the fixture (0,1,3,8,9) — the shared node (1,
    // WithClause) must appear exactly once despite having two parents.
    const withClauseNodes = nodes.filter((n) => n.id === "1")
    expect(withClauseNodes).toHaveLength(1)
    expect(nodes).toHaveLength(5)

    // Story 18.4: edges are drawn child(leaf-ward) -> parent(root-ward),
    // matching dagre's BT rank direction and "arrows pointing the way
    // execution flows" — the reverse of PlanNode.children's own parent->
    // child direction. WithClause's two Snowflake parentOperators (the
    // operators that CONSUME it) become two OUTGOING edges here; its own
    // single child (the TableScan feeding it) is one INCOMING edge.
    const edgesOutOfWithClause = edges.filter((e) => e.source === "1")
    expect(edgesOutOfWithClause).toHaveLength(2) // both of its Snowflake parents reference it
    const sharedEdges = edgesOutOfWithClause.filter((e) => e.data?.isSharedReference)
    expect(sharedEdges).toHaveLength(1) // exactly one of the two is the "repeat" reference
    expect(sharedEdges[0].style?.strokeDasharray).toBeTruthy()

    const edgesIntoWithClause = edges.filter((e) => e.target === "1")
    expect(edgesIntoWithClause).toHaveLength(1) // its own child (TableScan)
  })

  it("handles a large synthetic plan (500+ nodes) without throwing and assigns finite positions to every node", () => {
    function build(depth: number, breadth: number): { node: ReturnType<typeof makeNode>; count: number } {
      if (depth <= 0) return { node: makeNode({ actualRows: 10 }), count: 1 }
      const children = []
      let count = 1
      for (let i = 0; i < breadth; i++) {
        const c = build(depth - 1, breadth)
        children.push(c.node)
        count += c.count
      }
      return { node: makeNode({ actualRows: 10, children }), count }
    }
    const { node: root, count } = build(5, 4)
    expect(count).toBeGreaterThan(500)
    const { nodes } = buildGraphElements(root)
    expect(nodes).toHaveLength(count)
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true)
      expect(Number.isFinite(n.position.y)).toBe(true)
    }
  })

  it("all node ids referenced by the whole tree end up in the output for a fully-expanded plan", () => {
    const root = makeNode({
      id: "root",
      children: [makeNode({ id: "a", children: [makeNode({ id: "b" })] }), makeNode({ id: "c" })],
    })
    const { nodes } = buildGraphElements(root)
    const idsInTree = collectNodes(root).map((n) => n.id)
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set(idsInTree))
  })

  describe("Episode 18, Story 18.4 — bottom-up layout, edge direction, and per-node encoding", () => {
    it("places leaves below the root — rankdir BT paired with child->parent edges", () => {
      const leaf = makeNode({ id: "leaf" })
      const root = makeNode({ id: "root", children: [leaf] })
      const { nodes } = buildGraphElements(root)
      const rootNode = nodes.find((n) => n.id === "root")!
      const leafNode = nodes.find((n) => n.id === "leaf")!
      expect(leafNode.position.y).toBeGreaterThan(rootNode.position.y)
    })

    it("draws every edge child -> parent, never parent -> child", () => {
      const leaf1 = makeNode({ id: "leaf1" })
      const leaf2 = makeNode({ id: "leaf2" })
      const root = makeNode({ id: "root", children: [leaf1, leaf2] })
      const { edges } = buildGraphElements(root)
      expect(edges.every((e) => e.target === "root")).toBe(true)
      expect(new Set(edges.map((e) => e.source))).toEqual(new Set(["leaf1", "leaf2"]))
    })

    it("assigns a distinct targetHandle per child, at the parent's bottom edge, so multiple inputs don't converge on one point", () => {
      const a = makeNode({ id: "a" })
      const b = makeNode({ id: "b" })
      const c = makeNode({ id: "c" })
      const root = makeNode({ id: "root", children: [a, b, c] })
      const { edges } = buildGraphElements(root)
      const handles = edges.map((e) => e.targetHandle).sort()
      expect(handles).toEqual([targetHandleId(0), targetHandleId(1), targetHandleId(2)])
    })

    it("gives every edge the smoothstep type with an 8px border radius, per spec §4", () => {
      const leaf = makeNode({ id: "leaf" })
      const root = makeNode({ id: "root", children: [leaf] })
      const { edges } = buildGraphElements(root)
      expect(edges[0].type).toBe("smoothstep")
      expect(edges[0].pathOptions).toEqual({ borderRadius: 8 })
    })

    it("marks the single heaviest child-to-parent edge at each level as the hot path, and no other", () => {
      const cheap = makeNode({ id: "cheap", actualTimeMs: 1 })
      const expensive = makeNode({ id: "expensive", actualTimeMs: 100 })
      const root = makeNode({ id: "root", actualTimeMs: 101, children: [cheap, expensive] })
      const { edges } = buildGraphElements(root)
      const hot = edges.filter((e) => e.data?.isHotPath)
      expect(hot).toHaveLength(1)
      expect(hot[0].source).toBe("expensive")
      const cheapEdge = edges.find((e) => e.source === "cheap")!
      expect(cheapEdge.data?.isHotPath).toBe(false)
      expect(cheapEdge.markerEnd).not.toBe(hot[0].markerEnd)
    })

    it("sets childCount to the real child count, or 1 for a collapsed node (the single placeholder handle), or 0 for a leaf", () => {
      const grandchild = makeNode({ id: "grandchild" })
      const child = makeNode({ id: "child", children: [grandchild, makeNode({ id: "gc2" })] })
      const root = makeNode({ id: "root", children: [child] })

      const expanded = buildGraphElements(root)
      const childNodeExpanded = expanded.nodes.find((n) => n.id === "child")!
      expect(childNodeExpanded.data.kind === "plan" && childNodeExpanded.data.childCount).toBe(2)
      const leafNode = expanded.nodes.find((n) => n.id === "grandchild")!
      expect(leafNode.data.kind === "plan" && leafNode.data.childCount).toBe(0)

      const collapsed = buildGraphElements(root, { collapsedIds: new Set(["child"]) })
      const childNodeCollapsed = collapsed.nodes.find((n) => n.id === "child")!
      expect(childNodeCollapsed.data.kind === "plan" && childNodeCollapsed.data.childCount).toBe(1)
    })

    it("computes a severity from the node's own worst warning, undefined when it has none", () => {
      const critical = makeNode({
        id: "critical",
        warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }],
      })
      const clean = makeNode({ id: "clean" })
      const root = makeNode({ id: "root", children: [critical, clean] })
      const { nodes } = buildGraphElements(root)
      const criticalNode = nodes.find((n) => n.id === "critical")!
      const cleanNode = nodes.find((n) => n.id === "clean")!
      expect(criticalNode.data.kind === "plan" && criticalNode.data.severity).toBe("critical")
      expect(cleanNode.data.kind === "plan" && cleanNode.data.severity).toBeUndefined()
    })

    it("resolves the operator icon key from operatorType, falling back to 'unknown' for an unmapped one", () => {
      const root = makeNode({ id: "root", operatorType: "seq_scan" })
      const { nodes } = buildGraphElements(root)
      expect(nodes[0].data.kind === "plan" && nodes[0].data.iconKey).toBe("scan")

      const weird = makeNode({ id: "weird", operatorType: "not_a_real_type" })
      const { nodes: weirdNodes } = buildGraphElements(weird)
      expect(weirdNodes[0].data.kind === "plan" && weirdNodes[0].data.iconKey).toBe("unknown")
    })

    it("sets subtitle from relation identity, falling back to index identity, undefined for neither", () => {
      const withRelation = makeNode({ id: "a", attributes: { "Relation Name": "orders" } })
      const withIndexOnly = makeNode({ id: "b", index: { name: "idx_orders_id" } })
      const withNeither = makeNode({ id: "c", operatorType: "sort" })
      const root = makeNode({ id: "root", children: [withRelation, withIndexOnly, withNeither] })
      const { nodes } = buildGraphElements(root)
      const a = nodes.find((n) => n.id === "a")!
      const b = nodes.find((n) => n.id === "b")!
      const c = nodes.find((n) => n.id === "c")!
      expect(a.data.kind === "plan" && a.data.subtitle).toBe("orders")
      expect(b.data.kind === "plan" && b.data.subtitle).toBe("idx_orders_id")
      expect(c.data.kind === "plan" && c.data.subtitle).toBeUndefined()
    })
  })
})

describe("computeHandleOffsetPercent", () => {
  it("centers a single input", () => {
    expect(computeHandleOffsetPercent(0, 1)).toBe(50)
  })

  it("spreads multiple inputs evenly across the bottom edge, never flush with the corners", () => {
    expect(computeHandleOffsetPercent(0, 2)).toBeCloseTo(33.33, 1)
    expect(computeHandleOffsetPercent(1, 2)).toBeCloseTo(66.67, 1)
    expect(computeHandleOffsetPercent(0, 3)).toBe(25)
    expect(computeHandleOffsetPercent(1, 3)).toBe(50)
    expect(computeHandleOffsetPercent(2, 3)).toBe(75)
  })

  it("treats a zero-count (leaf) case the same as a single input — no division by zero", () => {
    expect(Number.isFinite(computeHandleOffsetPercent(0, 0))).toBe(true)
  })
})
