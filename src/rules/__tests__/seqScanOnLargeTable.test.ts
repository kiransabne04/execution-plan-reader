import { describe, expect, it } from "vitest"
import { LARGE_TABLE_ROW_THRESHOLD, seqScanOnLargeTable } from "../seqScanOnLargeTable"
import { makeContext, makeNode } from "./testHelpers"

describe("seqScanOnLargeTable", () => {
  it("fires on a seq scan well above the row threshold", () => {
    const node = makeNode({
      operatorType: "seq_scan",
      rawOperatorLabel: "Seq Scan",
      actualRows: LARGE_TABLE_ROW_THRESHOLD * 5,
      attributes: { "Relation Name": "orders" },
    })
    const warnings = seqScanOnLargeTable(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("seq-scan-on-large-table")
    expect(warnings[0].shortText).toContain("orders")
  })

  it("does NOT fire on a seq scan of a small table (the beginner-misconception case)", () => {
    const node = makeNode({
      operatorType: "seq_scan",
      actualRows: 200,
      attributes: { "Relation Name": "lookup_codes" },
    })
    expect(seqScanOnLargeTable(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-scan operator", () => {
    const node = makeNode({ operatorType: "hash_join", actualRows: 1_000_000 })
    expect(seqScanOnLargeTable(node, makeContext(node))).toEqual([])
  })

  it("falls back to estimatedRows when actualRows is absent (estimate-only plan)", () => {
    const node = makeNode({ operatorType: "seq_scan", estimatedRows: LARGE_TABLE_ROW_THRESHOLD * 2 })
    expect(seqScanOnLargeTable(node, makeContext(node))).toHaveLength(1)
  })

  it("does not throw and does not fire when both row counts are missing", () => {
    const node = makeNode({ operatorType: "seq_scan" })
    expect(() => seqScanOnLargeTable(node, makeContext(node))).not.toThrow()
    expect(seqScanOnLargeTable(node, makeContext(node))).toEqual([])
  })

  it("strips bracket quoting from SQL Server table names", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "seq_scan",
      rawOperatorLabel: "Table Scan",
      actualRows: LARGE_TABLE_ROW_THRESHOLD * 3,
      attributes: { "Object.Table": "[BigTable]" },
    })
    const warnings = seqScanOnLargeTable(node, makeContext(node))
    expect(warnings[0].shortText).toContain("BigTable")
    expect(warnings[0].shortText).not.toContain("[BigTable]")
  })
})
