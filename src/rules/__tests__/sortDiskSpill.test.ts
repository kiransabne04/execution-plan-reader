import { describe, expect, it } from "vitest"
import { sortDiskSpill } from "../sortDiskSpill"
import { makeContext, makeNode } from "./testHelpers"

describe("sortDiskSpill", () => {
  it("fires sort-disk (warning) for a material external merge", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 200_000, sort: { method: "external merge", spaceUsedKb: 10_000, spaceType: "disk" } })
    const warnings = sortDiskSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("sort-disk")
    expect(warnings[0].severity).toBe("warning")
  })

  it("fires sort-large (critical) for a much bigger disk-sort volume", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 5_000_000, sort: { method: "external sort", spaceUsedKb: 200_000, spaceType: "disk" } })
    const warnings = sortDiskSpill(node, makeContext(node))
    expect(warnings[0].ruleId).toBe("sort-large")
    expect(warnings[0].severity).toBe("critical")
  })

  it("does NOT warn on a normal in-memory quicksort", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 100, sort: { method: "quicksort", spaceUsedKb: 25, spaceType: "memory" } })
    expect(sortDiskSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT warn on a normal in-memory top-N heapsort", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 100, sort: { method: "top-N heapsort", spaceUsedKb: 25, spaceType: "memory" } })
    expect(sortDiskSpill(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a trivially small external sort (below the materiality floor)", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 10, sort: { method: "external merge", spaceUsedKb: 10, spaceType: "disk" } })
    expect(sortDiskSpill(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when sort info is absent", () => {
    const node = makeNode({ operatorType: "sort", actualRows: 100 })
    expect(() => sortDiskSpill(node, makeContext(node))).not.toThrow()
    expect(sortDiskSpill(node, makeContext(node))).toEqual([])
  })
})
