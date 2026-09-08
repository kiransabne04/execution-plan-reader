import { describe, expect, it } from "vitest"
import { sqlServerTableSpoolExpensive } from "../sqlServerTableSpoolExpensive"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeSpool(overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "sqlserver", operatorType: "spool", rawOperatorLabel: "Table Spool", attributes: { LogicalOp: "Eager Spool" }, ...overrides })
}

describe("sqlServerTableSpoolExpensive", () => {
  it("does NOT fire on a low-repetition spool", () => {
    const node = makeSpool({ rebinds: 5, rewinds: 5, actualRows: 100 })
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when repeated but with trivial row/time volume", () => {
    const node = makeSpool({ rebinds: 2_000, rewinds: 0, actualRows: 10, actualTimeMs: 5 })
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))).toEqual([])
  })

  it("fires critical when rebind-dominated (cache mostly ineffective) with material volume", () => {
    const node = makeSpool({ rebinds: 19_999, rewinds: 0, actualRows: 20_000, actualTimeMs: 9_000 })
    const warnings = sqlServerTableSpoolExpensive(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("table-spool-expensive")
    expect(warnings[0].severity).toBe("critical")
  })

  it("fires warning when rewind-dominated (cache working) but volume still material", () => {
    const node = makeSpool({ rebinds: 200, rewinds: 14_799, actualRows: 15_000, actualTimeMs: 7_000 })
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("does NOT fire on an Index Spool (that's sqlServerIndexSpool's job)", () => {
    const node = makeSpool({ rawOperatorLabel: "Index Spool", rebinds: 19_999, rewinds: 0, actualRows: 20_000 })
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const node = makeNode({ engine: "postgres", rawOperatorLabel: "Table Spool", rebinds: 19_999, rewinds: 0, actualRows: 20_000 })
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))).toEqual([])
  })

  it("never says 'remove the spool'", () => {
    const node = makeSpool({ rebinds: 19_999, rewinds: 0, actualRows: 20_000, actualTimeMs: 9_000 })
    const longText = sqlServerTableSpoolExpensive(node, makeContext(node))[0].longText
    expect(longText.toLowerCase()).not.toContain("remove the spool")
  })

  it("explains why SQL Server materialized the result, including the correctness (Halloween Protection) angle", () => {
    const node = makeSpool({ rebinds: 19_999, rewinds: 0, actualRows: 20_000, actualTimeMs: 9_000 })
    const longText = sqlServerTableSpoolExpensive(node, makeContext(node))[0].longText
    expect(longText).toContain("Halloween Protection")
    expect(longText).toContain("correlated")
  })

  it("does not throw or misfire when rebinds/rewinds are entirely absent", () => {
    const node = makeSpool({ rebinds: undefined, rewinds: undefined, actualRows: 20_000 })
    expect(() => sqlServerTableSpoolExpensive(node, makeContext(node))).not.toThrow()
    expect(sqlServerTableSpoolExpensive(node, makeContext(node))).toEqual([])
  })

  it("does not throw on pathological numeric input", () => {
    for (const rebinds of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeSpool({ rebinds, rewinds: 0, actualRows: 20_000, actualTimeMs: 9_000 })
      expect(() => sqlServerTableSpoolExpensive(node, makeContext(node))).not.toThrow()
    }
  })
})
