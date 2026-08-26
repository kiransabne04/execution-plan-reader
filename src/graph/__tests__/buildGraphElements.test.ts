import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { buildGraphElements } from "../buildGraphElements"
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
    expect(edges.some((e) => e.source === "child" && e.target === "child::collapsed")).toBe(true)
  })

  it("renders a shared multi-parent reference (Snowflake DAG) exactly once, with a dashed linking edge for the repeat", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("snowflake", "multi-parent-with-clause.json"))
    const { nodes, edges } = buildGraphElements(root)

    // 5 distinct operators in the fixture (0,1,3,8,9) — the shared node (1,
    // WithClause) must appear exactly once despite having two parents.
    const withClauseNodes = nodes.filter((n) => n.id === "1")
    expect(withClauseNodes).toHaveLength(1)
    expect(nodes).toHaveLength(5)

    // Edges are drawn parent(root-ward) -> child(leaf-ward), matching
    // PlanNode.children (= "operators feeding this one") and dagre's TB
    // rank direction. WithClause's two Snowflake parentOperators become two
    // incoming edges here; its own single child (the TableScan feeding it)
    // is one outgoing edge.
    const edgesIntoWithClause = edges.filter((e) => e.target === "1")
    expect(edgesIntoWithClause).toHaveLength(2) // both of its Snowflake parents reference it
    const sharedEdges = edgesIntoWithClause.filter((e) => e.data?.isSharedReference)
    expect(sharedEdges).toHaveLength(1) // exactly one of the two is the "repeat" reference
    expect(sharedEdges[0].style?.strokeDasharray).toBeTruthy()

    const edgesOutOfWithClause = edges.filter((e) => e.source === "1")
    expect(edgesOutOfWithClause).toHaveLength(1) // its own child (TableScan)
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
})
