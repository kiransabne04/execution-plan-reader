import { describe, expect, it } from "vitest"
import { partitionFanout } from "../partitionFanout"
import { makeContext, makeNode } from "./testHelpers"

function manyChildren(count: number) {
  return Array.from({ length: count }, (_, i) => makeNode({ id: `child-${i}` }))
}

describe("partitionFanout", () => {
  it("fires an info-severity observational note for large fan-out with NO pruning evidence", () => {
    const node = makeNode({ operatorType: "append", children: manyChildren(50) })
    const warnings = partitionFanout(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("partition-fanout")
    expect(warnings[0].severity).toBe("info")
  })

  it("never claims poor pruning — stays observational, no verdict", () => {
    const node = makeNode({ operatorType: "append", children: manyChildren(50) })
    const [warning] = partitionFanout(node, makeContext(node))
    expect(warning.longText).toMatch(/not a claim that pruning is working poorly/i)
  })

  it("does NOT fire when real pruning evidence (Subplans Removed) exists — nothing to flag either way", () => {
    const node = makeNode({ operatorType: "append", children: manyChildren(50), pruning: { subplansRemoved: 45 } })
    expect(partitionFanout(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the fan-out threshold", () => {
    const node = makeNode({ operatorType: "append", children: manyChildren(3) })
    expect(partitionFanout(node, makeContext(node))).toEqual([])
  })

  it("also recognizes MergeAppend, not just Append", () => {
    const node = makeNode({ operatorType: "merge_append", children: manyChildren(50) })
    expect(partitionFanout(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire on a non-partition-container operator", () => {
    const node = makeNode({ operatorType: "hash_join", children: manyChildren(50) })
    expect(partitionFanout(node, makeContext(node))).toEqual([])
  })
})
