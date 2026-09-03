import { describe, expect, it } from "vitest"
import { indexOnlyHeapFetches, MIN_ACTUAL_ROWS_THRESHOLD } from "../indexOnlyHeapFetches"
import { makeContext, makeNode } from "./testHelpers"

describe("indexOnlyHeapFetches", () => {
  it("fires critical for the story's own example (1.5M rows, 1.35M heap fetches — 90%)", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: 1_500_000, heapFetches: 1_350_000 })
    const warnings = indexOnlyHeapFetches(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("index-only-heap-fetches")
    expect(warnings[0].severity).toBe("critical")
    // Correctly hedged, not a bare confident claim — the rule must never
    // assert VACUUM is definitely required (this story's own instruction).
    expect(warnings[0].longText).toMatch(/does not necessarily mean vacuum needs to run/i)
    expect(warnings[0].longText).toMatch(/investigate visibility-map coverage and vacuum behavior/i)
  })

  it("fires warning at a lower (10-50%) fetch ratio", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: 10_000, heapFetches: 2_000 })
    expect(indexOnlyHeapFetches(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("does not call the scan healthy — never suppresses just because it IS an Index Only Scan", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: 1_500_000, heapFetches: 1_500_000 })
    expect(indexOnlyHeapFetches(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire below the volume floor even at a 100% fetch ratio", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: MIN_ACTUAL_ROWS_THRESHOLD - 1, heapFetches: MIN_ACTUAL_ROWS_THRESHOLD - 1 })
    expect(indexOnlyHeapFetches(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a genuinely healthy Index Only Scan (low fetch ratio)", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: 1_500_000, heapFetches: 5_000 })
    expect(indexOnlyHeapFetches(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-Index-Only-Scan operator, even with a heapFetches value present", () => {
    const node = makeNode({ operatorType: "index_scan", actualRows: 1_500_000, heapFetches: 1_350_000 })
    expect(indexOnlyHeapFetches(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when heapFetches is absent", () => {
    const node = makeNode({ operatorType: "index_only_scan", actualRows: 1_500_000 })
    expect(() => indexOnlyHeapFetches(node, makeContext(node))).not.toThrow()
    expect(indexOnlyHeapFetches(node, makeContext(node))).toEqual([])
  })
})
