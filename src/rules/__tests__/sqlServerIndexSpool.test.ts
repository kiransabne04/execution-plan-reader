import { describe, expect, it } from "vitest"
import { sqlServerIndexSpool } from "../sqlServerIndexSpool"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeSpool(overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "sqlserver", operatorType: "spool", rawOperatorLabel: "Index Spool", ...overrides })
}

function run(node: PlanNode) {
  return sqlServerIndexSpool(node, makeContext(node))
}

describe("sqlServerIndexSpool", () => {
  it("does NOT fire on a low-repetition spool", () => {
    const node = makeSpool({ rebinds: 5, rewinds: 5, actualRows: 100 })
    expect(run(node)).toEqual([])
  })

  it("fires warning on a rewind-dominated Index Spool with material volume", () => {
    const node = makeSpool({ rebinds: 200, rewinds: 14_799, actualRows: 15_000, actualTimeMs: 7_000 })
    const warnings = run(node)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("index-spool-repeated")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical when rebind-dominated", () => {
    const node = makeSpool({ rebinds: 14_000, rewinds: 799, actualRows: 15_000, actualTimeMs: 7_000 })
    expect(run(node)[0].severity).toBe("critical")
  })

  it("does NOT fire on a Table Spool (that's sqlServerTableSpoolExpensive's job)", () => {
    const node = makeSpool({ rawOperatorLabel: "Table Spool", rebinds: 200, rewinds: 14_799, actualRows: 15_000 })
    expect(run(node)).toEqual([])
  })

  it("explains the temporary indexed structure and repeated access pattern", () => {
    const node = makeSpool({ rebinds: 200, rewinds: 14_799, actualRows: 15_000, actualTimeMs: 7_000 })
    const longText = run(node)[0].longText
    expect(longText).toContain("temporary index")
    expect(longText).toContain("seek")
  })

  it("is a genuinely separate ruleId from table-spool-expensive", () => {
    const node = makeSpool({ rebinds: 200, rewinds: 14_799, actualRows: 15_000, actualTimeMs: 7_000 })
    expect(run(node)[0].ruleId).not.toBe("table-spool-expensive")
  })

  it("does not throw on pathological numeric input", () => {
    for (const rewinds of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeSpool({ rebinds: 0, rewinds, actualRows: 15_000 })
      expect(() => run(node)).not.toThrow()
    }
  })
})
