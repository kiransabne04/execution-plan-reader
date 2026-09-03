import { describe, expect, it } from "vitest"
import { filterRowsDiscarded } from "../filterRowsDiscarded"
import { makeContext, makeNode } from "./testHelpers"

describe("filterRowsDiscarded", () => {
  it("fires critical for the story's own bad example (removed 9,000,000 / returned 100)", () => {
    const node = makeNode({ rowsRemovedByFilter: 9_000_000, actualRows: 100, actualTimeMs: 4000 })
    const warnings = filterRowsDiscarded(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("filter-rows-discarded")
    expect(warnings[0].severity).toBe("critical")
  })

  it("does not fire for the story's own healthy example (removed 30 / returned 10 / 0.03ms)", () => {
    const node = makeNode({ rowsRemovedByFilter: 30, actualRows: 10, actualTimeMs: 0.03 })
    expect(filterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the absolute volume floor even at a 100% discard ratio", () => {
    const node = makeNode({ rowsRemovedByFilter: 500, actualRows: 0, actualTimeMs: 10 })
    expect(filterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("multiplies by loops for the volume floor — a small per-iteration count with high loops still fires", () => {
    const node = makeNode({ rowsRemovedByFilter: 200, actualRows: 1, actualTimeMs: 1, loops: 100 })
    expect(filterRowsDiscarded(node, makeContext(node))).toHaveLength(1)
  })

  it("suppresses a high-ratio/high-volume case that ran in under the time floor", () => {
    const node = makeNode({ rowsRemovedByFilter: 9_000_000, actualRows: 100, actualTimeMs: 0.5 })
    expect(filterRowsDiscarded(node, makeContext(node))).toEqual([])
  })

  it("avoids blanket index advice — states the symptom, not a direct 'add an index' instruction", () => {
    const node = makeNode({ rowsRemovedByFilter: 9_000_000, actualRows: 100, actualTimeMs: 4000 })
    const [warning] = filterRowsDiscarded(node, makeContext(node))
    expect(warning.longText).toMatch(/substantially more rows than it returned|read.*more rows/i)
    expect(warning.longText).not.toMatch(/^add an index|^create an index/i)
  })

  it("does not fire and does not throw when rowsRemovedByFilter is absent", () => {
    const node = makeNode({ actualRows: 5 })
    expect(() => filterRowsDiscarded(node, makeContext(node))).not.toThrow()
    expect(filterRowsDiscarded(node, makeContext(node))).toEqual([])
  })
})
