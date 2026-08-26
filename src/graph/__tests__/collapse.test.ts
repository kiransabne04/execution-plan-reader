import { describe, expect, it } from "vitest"
import { COLLAPSE_NODE_COUNT_THRESHOLD, computeDefaultCollapsedIds } from "../collapse"
import { collectNodes, type PlanNode } from "../../parsers/normalize"
import { makeNode } from "../../rules/__tests__/testHelpers"

function buildFillerChain(depth: number, leafId: string): PlanNode {
  let node = makeNode({ id: leafId, actualTimeMs: 0.001 })
  for (let i = 0; i < depth; i++) {
    node = makeNode({ id: `filler-${i}`, actualTimeMs: 0.001, children: [node] })
  }
  return node
}

/** One expensive branch (dominates plan cost) alongside a long, cheap
 * filler branch — the filler branch's top node should collapse by default
 * once the plan is large, since it contributes negligible cost. */
function buildTwoBranchTree(fillerDepth: number): { root: PlanNode; fillerBranchRootId: string } {
  const expensive = makeNode({ id: "expensive", actualTimeMs: 1_000_000 })
  const filler = buildFillerChain(fillerDepth, "filler-leaf")
  const root = makeNode({ id: "root", actualTimeMs: 0, children: [expensive, filler] })
  return { root, fillerBranchRootId: filler.id }
}

describe("computeDefaultCollapsedIds", () => {
  it("never collapses anything below the node-count threshold, regardless of cost skew", () => {
    const { root } = buildTwoBranchTree(20)
    expect(collectNodes(root).length).toBeLessThan(COLLAPSE_NODE_COUNT_THRESHOLD)
    expect(computeDefaultCollapsedIds(root, collectNodes(root))).toEqual(new Set())
  })

  it("collapses the low-contribution filler branch once the plan exceeds the size threshold", () => {
    const { root, fillerBranchRootId } = buildTwoBranchTree(COLLAPSE_NODE_COUNT_THRESHOLD + 50)
    const allNodes = collectNodes(root)
    expect(allNodes.length).toBeGreaterThan(COLLAPSE_NODE_COUNT_THRESHOLD)
    const collapsed = computeDefaultCollapsedIds(root, allNodes)
    expect(collapsed.has(fillerBranchRootId)).toBe(true)
    // The expensive branch (most of the plan's cost) stays expanded.
    expect(collapsed.has("expensive")).toBe(false)
  })

  it("never collapses the plan root, and never marks a leaf as a collapse boundary", () => {
    const { root } = buildTwoBranchTree(COLLAPSE_NODE_COUNT_THRESHOLD + 50)
    const allNodes = collectNodes(root)
    const collapsed = computeDefaultCollapsedIds(root, allNodes)
    expect(collapsed.has(root.id)).toBe(false)
    for (const id of collapsed) {
      const node = allNodes.find((n) => n.id === id)
      expect(node?.children.length).toBeGreaterThan(0)
    }
  })

  it("does not throw on a single-node plan", () => {
    const root = makeNode({})
    expect(() => computeDefaultCollapsedIds(root, collectNodes(root))).not.toThrow()
  })
})
