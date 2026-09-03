import { describe, expect, it } from "vitest"
import { applyRules } from "../index"
import { buildPlanContext } from "../types"
import { linkPropagatedFindings, groupByRootCause } from "../cardinalityPropagation"
import { makeNode } from "./testHelpers"

// The story's own worked example: a scan's bad estimate propagating into a
// nested loop explosion, which itself feeds an outer high-loop-count
// aggregate — a genuine 3-level chain, built as a real tree and run
// through the real rule engine (not hand-assembled Warning[] literals),
// so this test exercises the exact same ancestry data the real app
// produces.
function makeChainTree() {
  // Leaf: badly-estimated scan (estimate 10 → actual 40,000).
  const scan = makeNode({ id: "scan", operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", estimatedRows: 10, actualRows: 40_000 })

  // Inner side of the nested loop: cheap-per-loop, but looped many times.
  const innerLookup = makeNode({ id: "inner-lookup", operatorType: "index_scan", rawOperatorLabel: "Index Scan", loops: 40_000, actualTimeMs: 1 })

  // Nested Loop: outer = the bad-estimate scan, inner = the lookup above —
  // this should trigger `nested-loop-explosion`.
  const nestedLoop = makeNode({
    id: "nested-loop",
    engine: "postgres",
    operatorType: "nested_loop_join",
    rawOperatorLabel: "Nested Loop",
    estimatedRows: 100,
    actualRows: 40_000,
    children: [scan, innerLookup],
  })

  // Aggregate on top: high-loop-count style symptom further up the chain
  // (a generic operator repeatedly re-invoked, standing in for the story's
  // own "Aggregate" example).
  const aggregate = makeNode({
    id: "aggregate",
    operatorType: "aggregate",
    rawOperatorLabel: "Aggregate",
    loops: 40_000,
    actualTimeMs: 2,
    children: [nestedLoop],
  })

  return applyRules(aggregate, buildPlanContext(aggregate))
}

describe("linkPropagatedFindings", () => {
  it("links the scan's bad-row-estimate to the downstream nested-loop-explosion", () => {
    const root = makeChainTree()
    const relationships = linkPropagatedFindings(root)

    const scanToLoop = relationships.find((r) => r.causeNodeId === "scan" && r.effectNodeId === "nested-loop")
    expect(scanToLoop).toBeDefined()
    expect(scanToLoop?.causeFamily).toBe("bad-row-estimate")
    expect(scanToLoop?.effectFamily).toBe("nested-loop-explosion")
    expect(scanToLoop?.hops).toBe(1)
  })

  it("returns no relationships on a tree with no findings at all", () => {
    const root = makeNode({ id: "lone", operatorType: "seq_scan" })
    expect(linkPropagatedFindings(applyRules(root, buildPlanContext(root)))).toEqual([])
  })

  it("returns no relationships when only a cause fires with no qualifying effect anywhere in the tree", () => {
    const scan = makeNode({ id: "isolated-scan", operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const root = applyRules(scan, buildPlanContext(scan))
    expect(linkPropagatedFindings(root)).toEqual([])
  })

  it("never links a cause to an effect that isn't its own ancestor/descendant", () => {
    // Two independent branches under one root: a bad-row-estimate on one
    // side, an exploding-join on the completely unrelated other side.
    const badEstimateLeaf = makeNode({ id: "leaf-a", operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const branchA = makeNode({ id: "branch-a", operatorType: "index_scan", children: [badEstimateLeaf] })

    const explodingChildA = makeNode({ id: "leaf-b1", operatorType: "seq_scan", actualRows: 5 })
    const explodingChildB = makeNode({ id: "leaf-b2", operatorType: "seq_scan", actualRows: 5 })
    const branchB = makeNode({ id: "branch-b", operatorType: "hash_join", actualRows: 500, children: [explodingChildA, explodingChildB] })

    const root = makeNode({ id: "root", operatorType: "gather", children: [branchA, branchB] })
    const analyzed = applyRules(root, buildPlanContext(root))

    const relationships = linkPropagatedFindings(analyzed)
    expect(relationships.find((r) => r.effectNodeId === "branch-b")).toBeUndefined()
  })
})

describe("groupByRootCause", () => {
  it("groups the scan as primary with the nested-loop-explosion as a consequence", () => {
    const root = makeChainTree()
    const groups = groupByRootCause(root)

    const scanGroup = groups.find((g) => g.primary.nodeId === "scan")
    expect(scanGroup).toBeDefined()
    expect(scanGroup?.primary.warning.ruleId).toBe("bad-row-estimate")
    expect(scanGroup?.consequences.some((c) => c.warning.ruleId === "nested-loop-explosion")).toBe(true)
  })

  it("returns no groups when there are no propagation relationships", () => {
    const scan = makeNode({ id: "solo", operatorType: "seq_scan" })
    expect(groupByRootCause(applyRules(scan, buildPlanContext(scan)))).toEqual([])
  })

  it("never lists the same finding family twice within one group's consequences", () => {
    const root = makeChainTree()
    const groups = groupByRootCause(root)
    for (const group of groups) {
      const families = group.consequences.map((c) => c.warning.ruleId)
      expect(new Set(families).size).toBe(families.length)
    }
  })
})
