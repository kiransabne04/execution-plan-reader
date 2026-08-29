import { describe, expect, it } from "vitest"
import { searchNodes } from "../searchNodes"
import { makeNode } from "../../../rules/__tests__/testHelpers"

describe("searchNodes", () => {
  it("is inactive with an empty query and 'all' severity — every node matches, but isActive is false", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const result = searchNodes(root, "", "all")
    expect(result.isActive).toBe(false)
    expect(result.matchedIds).toEqual(new Set(["root", "leaf"]))
  })

  it("matches by rawOperatorLabel, case-insensitively", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const result = searchNodes(root, "hash", "all")
    expect(result.isActive).toBe(true)
    expect(result.matchedIds).toEqual(new Set(["root"]))
  })

  it("matches by relation name", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan", attributes: { "Relation Name": "orders" } })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const result = searchNodes(root, "orders", "all")
    expect(result.matchedIds).toEqual(new Set(["leaf"]))
  })

  it("matches by index name", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Index Scan", index: { name: "idx_orders_customer_id" } })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const result = searchNodes(root, "idx_orders", "all")
    expect(result.matchedIds).toEqual(new Set(["leaf"]))
  })

  it("matches by severity WORD in the free-text query too, not only via the severity filter chip", () => {
    const leaf = makeNode({
      id: "leaf",
      rawOperatorLabel: "Seq Scan",
      warnings: [{ ruleId: "seq-scan-on-large-table", severity: "warning", shortText: "x", longText: "y" }],
    })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const result = searchNodes(root, "warning", "all")
    expect(result.matchedIds).toEqual(new Set(["leaf"]))
  })

  it("the severity filter narrows to nodes carrying that severity, independent of the text query", () => {
    const critical = makeNode({
      id: "critical",
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }],
    })
    const clean = makeNode({ id: "clean" })
    const root = makeNode({ id: "root", children: [critical, clean] })
    const result = searchNodes(root, "", "critical")
    expect(result.isActive).toBe(true)
    expect(result.matchedIds).toEqual(new Set(["critical"]))
  })

  it("combines a text query AND a severity filter — both must hold", () => {
    const criticalScan = makeNode({
      id: "a",
      rawOperatorLabel: "Seq Scan",
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }],
    })
    const criticalJoin = makeNode({
      id: "b",
      rawOperatorLabel: "Hash Join",
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }],
    })
    const cleanScan = makeNode({ id: "c", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", children: [criticalScan, criticalJoin, cleanScan] })
    const result = searchNodes(root, "scan", "critical")
    expect(result.matchedIds).toEqual(new Set(["a"]))
  })

  it("a query matching nothing returns an active, empty result — not a crash, not 'everything matches'", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    const result = searchNodes(root, "nonexistent-operator-xyz", "all")
    expect(result.isActive).toBe(true)
    expect(result.matchedIds.size).toBe(0)
    expect(result.matches).toEqual([])
  })

  it("returns matches in tree order, root first", () => {
    const leaf1 = makeNode({ id: "leaf1", rawOperatorLabel: "Seq Scan" })
    const leaf2 = makeNode({ id: "leaf2", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Append", children: [leaf1, leaf2] })
    const result = searchNodes(root, "scan", "all")
    expect(result.matches.map((n) => n.id)).toEqual(["leaf1", "leaf2"])
  })
})
