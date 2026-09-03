import { describe, expect, it } from "vitest"
import { joinFilterRowsDiscarded } from "../joinFilterRowsDiscarded"
import { makeContext, makeNode } from "./testHelpers"

describe("joinFilterRowsDiscarded", () => {
  it("fires for the story's own example (50k returned after filtering 20M candidate combinations)", () => {
    const node = makeNode({ operatorType: "hash_join", rowsRemovedByJoinFilter: 19_950_000, actualRows: 50_000 })
    const warnings = joinFilterRowsDiscarded(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("join-filter-rows-discarded")
    expect(warnings[0].severity).toBe("critical")
  })

  it("never diagnoses one specific cause — lists multiple honestly, per the story's own instruction", () => {
    const node = makeNode({ operatorType: "hash_join", rowsRemovedByJoinFilter: 19_950_000, actualRows: 50_000 })
    const [warning] = joinFilterRowsDiscarded(node, makeContext(node))
    expect(warning.longText).toMatch(/inefficient join condition/i)
    expect(warning.longText).toMatch(/ordering/i)
    expect(warning.longText).toMatch(/cardinality/i)
  })

  it("does not fire below the absolute volume floor", () => {
    const node = makeNode({ operatorType: "hash_join", rowsRemovedByJoinFilter: 500, actualRows: 5 })
    expect(joinFilterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a healthy join with a low discard ratio", () => {
    const node = makeNode({ operatorType: "hash_join", rowsRemovedByJoinFilter: 100, actualRows: 900_000 })
    expect(joinFilterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-join operator", () => {
    const node = makeNode({ operatorType: "seq_scan", rowsRemovedByJoinFilter: 19_950_000, actualRows: 50_000 })
    expect(joinFilterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when rowsRemovedByJoinFilter is absent", () => {
    const node = makeNode({ operatorType: "hash_join", actualRows: 50_000 })
    expect(() => joinFilterRowsDiscarded(node, makeContext(node))).not.toThrow()
    expect(joinFilterRowsDiscarded(node, makeContext(node))).toEqual([])
  })
})
