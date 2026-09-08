import { describe, expect, it } from "vitest"
import { residualPredicateHeavy } from "../residualPredicateHeavy"
import type { PlanNode } from "../../parsers/normalize"
import { makeContext, makeNode } from "./testHelpers"

function makeSeek(overrides: Partial<PlanNode> = {}) {
  return makeNode({
    engine: "sqlserver",
    operatorType: "index_seek",
    rawOperatorLabel: "Index Seek",
    predicate: { indexCondition: "[Status] = 'active'", filter: "[CreatedAt] > '2020-01-01'" },
    ...overrides,
  })
}

describe("residualPredicateHeavy", () => {
  it("does NOT fire on a healthy seek: small residual filter, well-selective seek", () => {
    // Seek reads 1,050 rows, residual filter removes 50 — a normal,
    // mostly-seek-driven result.
    const node = makeSeek({ actualRows: 1_000, rowsRemovedByFilter: 50 })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("fires on the story's own example: 5,000,000 read, 2,000 returned", () => {
    const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter: 4_998_000 })
    const warnings = residualPredicateHeavy(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("residual-predicate-heavy")
    expect(warnings[0].severity).toBe("critical")
    expect(warnings[0].shortText).toContain("5,000,000")
    expect(warnings[0].shortText).toContain("2,000")
  })

  it("does NOT fire without a real seek predicate (indexCondition missing)", () => {
    const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter: 4_998_000, predicate: { filter: "[CreatedAt] > '2020-01-01'" } })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire without a real residual predicate (filter missing) — a fully-covered seek", () => {
    const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter: 4_998_000, predicate: { indexCondition: "[Status] = 'active'" } })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("ratio floor alone excludes a case with large absolute volume but low discard ratio", () => {
    // 50,000 removed but 500,000 returned — ratio ~0.09, well below the floor.
    const node = makeSeek({ actualRows: 500_000, rowsRemovedByFilter: 50_000 })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("absolute-volume floor alone excludes a case with a high ratio but tiny volume", () => {
    // 95% discard ratio, but only 95 rows removed total — technically-true
    // but practically-meaningless, same shape filterRowsDiscarded guards.
    const node = makeSeek({ actualRows: 5, rowsRemovedByFilter: 95 })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const node = makeSeek({ engine: "postgres", actualRows: 2_000, rowsRemovedByFilter: 4_998_000 })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on an operator other than index_seek", () => {
    const node = makeSeek({ operatorType: "index_scan", actualRows: 2_000, rowsRemovedByFilter: 4_998_000 })
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on an estimate-only plan (no actualRows/rowsRemovedByFilter at all)", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "index_seek",
      estimatedRows: 5_000_000,
      predicate: { indexCondition: "[Status] = 'active'", filter: "[CreatedAt] > '2020-01-01'" },
    })
    expect(() => residualPredicateHeavy(node, makeContext(node))).not.toThrow()
    expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
  })

  it("escalates to critical only above the critical ratio, stays warning below it", () => {
    // ratio ~0.9412 — above 0.9 (warning) but below 0.99 (critical).
    const warningCase = makeSeek({ actualRows: 1_000, rowsRemovedByFilter: 16_000 })
    expect(residualPredicateHeavy(warningCase, makeContext(warningCase))[0].severity).toBe("warning")

    const criticalCase = makeSeek({ actualRows: 1_000, rowsRemovedByFilter: 4_999_000 })
    expect(residualPredicateHeavy(criticalCase, makeContext(criticalCase))[0].severity).toBe("critical")
  })

  it("explains the seek-vs-residual pattern with the exact requested framing, and names both figures", () => {
    const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter: 4_998_000 })
    const longText = residualPredicateHeavy(node, makeContext(node))[0].longText
    expect(longText).toContain("SQL Server used an Index Seek, but the seek was not selective enough by itself")
    expect(longText).toContain("most rows were eliminated")
    expect(longText).toContain("residual predicate")
    expect(longText).toContain("Actual Rows Read")
    expect(longText).toContain("Actual Rows")
  })

  it("never claims every residual predicate is a problem", () => {
    const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter: 4_998_000 })
    const longText = residualPredicateHeavy(node, makeContext(node))[0].longText
    expect(longText).toContain("doesn't mean every residual predicate is a problem")
  })

  it("does not throw or misfire on pathological numeric input", () => {
    for (const rowsRemovedByFilter of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const node = makeSeek({ actualRows: 2_000, rowsRemovedByFilter })
      expect(() => residualPredicateHeavy(node, makeContext(node))).not.toThrow()
      expect(residualPredicateHeavy(node, makeContext(node))).toEqual([])
    }
  })
})
