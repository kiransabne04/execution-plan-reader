import { describe, expect, it } from "vitest"
import { sqlServerHashSpill } from "../sqlServerHashSpill"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeSpillingHash(overrides: Partial<PlanNode> = {}) {
  return makeNode({
    engine: "sqlserver",
    operatorType: "hash_join",
    rawOperatorLabel: "Hash Match",
    spill: { occurred: true, detail: "spill level 1" },
    attributes: { "Spill Level": 1 },
    ...overrides,
  })
}

describe("sqlServerHashSpill", () => {
  it("does NOT fire when no spill occurred", () => {
    const node = makeNode({ engine: "sqlserver", rawOperatorLabel: "Hash Match", spill: undefined })
    expect(sqlServerHashSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine, even with spill.occurred true", () => {
    const node = makeNode({ engine: "postgres", rawOperatorLabel: "Hash Match", spill: { occurred: true } })
    expect(sqlServerHashSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a Sort (that's sqlServerSortSpill's job)", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "sort", rawOperatorLabel: "Sort", spill: { occurred: true }, attributes: { "Spill Level": 1 } })
    expect(sqlServerHashSpill(node, makeContext(node))).toEqual([])
  })

  it("fires on a spilling Hash Match regardless of which logical operation it's disambiguated into", () => {
    for (const operatorType of ["hash_join", "hash_aggregate", "hash_distinct", "hash_union"]) {
      const node = makeSpillingHash({ operatorType })
      expect(sqlServerHashSpill(node, makeContext(node))).toHaveLength(1)
    }
  })

  it("fires warning at spill level 1", () => {
    const node = makeSpillingHash({ attributes: { "Spill Level": 1 } })
    const warnings = sqlServerHashSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("sqlserver-hash-spill")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical at spill level 2+", () => {
    const node = makeSpillingHash({ attributes: { "Spill Level": 2 } })
    expect(sqlServerHashSpill(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("explains hash memory pressure (the build side didn't fit)", () => {
    const node = makeSpillingHash()
    const longText = sqlServerHashSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("hash table (the build side) didn't fit in its memory grant")
  })

  it("states partitions/batches are not exposed by Showplan XML, rather than fabricating a count", () => {
    const node = makeSpillingHash()
    const longText = sqlServerHashSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("doesn't expose a hash-partition or bucket count")
  })

  it("attributes reads to tempdb interaction with hash-specific wording, and states writes/pages are unavailable", () => {
    const node = makeSpillingHash({ io: { bufferHits: 0, bufferReads: 8_000 } })
    const longText = sqlServerHashSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("8,000")
    expect(longText).toContain("a Hash Match reads nothing from a table itself")
    expect(longText).toContain("doesn't report separate tempdb write counts or page counts")
  })

  it("never blindly recommends raising server memory as THE fix", () => {
    const node = makeSpillingHash()
    const longText = sqlServerHashSpill(node, makeContext(node))[0].longText
    expect(longText).toContain("A larger memory grant is only one possible fix, not automatically the right one")
    expect(longText).toContain("this plan alone can't say which one actually applies here")
  })

  it("exposes runtime contribution with a share of total when available", () => {
    const node = makeSpillingHash({ actualTimeMs: 2_000 })
    const root = makeNode({ actualTimeMs: 8_000, children: [node] })
    const context = makeContext(root, { hasActualData: true, totalActualTimeMs: 8_000 })
    const warnings = sqlServerHashSpill(node, context)
    expect(warnings[0].shortText).toContain("This Hash Match took 2000ms")
    expect(warnings[0].shortText).toContain("25.0%")
  })

  it("does not throw or misfire on pathological numeric input", () => {
    for (const spillLevel of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const node = makeSpillingHash({ attributes: { "Spill Level": spillLevel } })
      expect(() => sqlServerHashSpill(node, makeContext(node))).not.toThrow()
    }
  })
})
