import { describe, expect, it } from "vitest"
import { COLLAPSE_NODE_COUNT_THRESHOLD, computeDefaultCollapsedIds, findCollapsedAncestors } from "../collapse"
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

describe("findCollapsedAncestors", () => {
  it("returns the collapsed ancestor standing between the root and a hidden target node", () => {
    const { root, fillerBranchRootId } = buildTwoBranchTree(COLLAPSE_NODE_COUNT_THRESHOLD + 50)
    const collapsed = computeDefaultCollapsedIds(root, collectNodes(root))
    expect(collapsed.has(fillerBranchRootId)).toBe(true)

    const found = findCollapsedAncestors(root, "filler-leaf", collapsed)
    expect(found).toEqual(new Set([fillerBranchRootId]))
  })

  it("returns an empty set for a node that's already visible (no collapsed ancestor)", () => {
    const { root } = buildTwoBranchTree(COLLAPSE_NODE_COUNT_THRESHOLD + 50)
    const collapsed = computeDefaultCollapsedIds(root, collectNodes(root))
    expect(findCollapsedAncestors(root, "expensive", collapsed)).toEqual(new Set())
  })

  it("returns an empty set for an id that doesn't exist in the tree", () => {
    const { root } = buildTwoBranchTree(20)
    expect(findCollapsedAncestors(root, "does-not-exist", new Set(["expensive"]))).toEqual(new Set())
  })

  it("returns an empty set when collapsedIds is empty, regardless of tree shape", () => {
    const { root } = buildTwoBranchTree(COLLAPSE_NODE_COUNT_THRESHOLD + 50)
    expect(findCollapsedAncestors(root, "filler-leaf", new Set())).toEqual(new Set())
  })
})
