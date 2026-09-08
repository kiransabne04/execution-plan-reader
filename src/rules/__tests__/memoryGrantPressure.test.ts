import { describe, expect, it } from "vitest"
import { memoryGrantPressure } from "../memoryGrantPressure"
import { makeContext, makeNode } from "./testHelpers"

describe("memoryGrantPressure", () => {
  it("fires on a modest grant correlated with a real spill elsewhere in the tree", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", rawOperatorLabel: "Sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096 }, children: [spillingSort] })
    const warnings = memoryGrantPressure(root, makeContext(root))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("memory-grant-pressure")
    expect(warnings[0].severity).toBe("warning")
  })

  it("does NOT fire on a modest grant with no spill anywhere in the tree", () => {
    const child = makeNode({ engine: "sqlserver", operatorType: "sort" })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096 }, children: [child] })
    expect(memoryGrantPressure(root, makeContext(root))).toEqual([])
  })

  it("does NOT fire on a large grant even with a real spill — 'small grant' is required, not spill alone", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 1_048_576 }, children: [spillingSort] })
    expect(memoryGrantPressure(root, makeContext(root))).toEqual([])
  })

  it("does NOT trigger solely because used approximately equals granted, with no spill evidence", () => {
    const child = makeNode({ engine: "sqlserver", operatorType: "sort" })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096, maxUsedKb: 4_090 }, children: [child] })
    expect(memoryGrantPressure(root, makeContext(root))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const spillingSort = makeNode({ engine: "postgres", operatorType: "sort", spill: { occurred: true } })
    const root = makeNode({ engine: "postgres", memoryGrant: { grantedKb: 4_096 }, children: [spillingSort] })
    expect(memoryGrantPressure(root, makeContext(root))).toEqual([])
  })

  it("does NOT fire on a non-root node", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096 }, children: [spillingSort] })
    expect(memoryGrantPressure(spillingSort, makeContext(root))).toEqual([])
  })

  it("does NOT fire when memoryGrant is entirely absent", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", children: [spillingSort] })
    expect(() => memoryGrantPressure(root, makeContext(root))).not.toThrow()
    expect(memoryGrantPressure(root, makeContext(root))).toEqual([])
  })

  it("names the operator(s) that actually spilled", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", rawOperatorLabel: "Sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096 }, children: [spillingSort] })
    const longText = memoryGrantPressure(root, makeContext(root))[0].longText
    expect(longText).toContain("Sort")
  })

  it("explains why used≈granted alone isn't reliable evidence here", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", spill: { occurred: true } })
    const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 4_096 }, children: [spillingSort] })
    const longText = memoryGrantPressure(root, makeContext(root))[0].longText
    expect(longText).toContain("used-vs-granted memory alone")
  })

  it("does not throw on pathological numeric input", () => {
    const spillingSort = makeNode({ engine: "sqlserver", operatorType: "sort", spill: { occurred: true } })
    for (const grantedKb of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      const root = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb }, children: [spillingSort] })
      expect(() => memoryGrantPressure(root, makeContext(root))).not.toThrow()
    }
  })
})
