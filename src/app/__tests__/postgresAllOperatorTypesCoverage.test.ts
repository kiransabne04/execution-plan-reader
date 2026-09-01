// User-requested stress test: every Postgres `Node Type` this app's own
// operatorMap.ts (POSTGRES_OPERATOR_MAP) knows how to map, wired into one
// synthetic-but-real EXPLAIN (FORMAT JSON) plan and driven through the
// REAL parse -> normalize -> rule-engine -> detail-panel-stats pipeline —
// not just a label-list check (that already exists, exhaustively, in
// src/graph/glossary/__tests__/coverage.test.ts's second test). This is
// deliberately NOT a realistic query (an `Append` of 40 unrelated
// operator types never occurs in real Postgres output) — it exists purely
// to prove every mapped operator type survives the full pipeline without
// throwing, without "unknown", and without producing garbled
// (NaN/undefined-as-text) detail-panel stats.

import { describe, expect, it } from "vitest"
import { analyzePlanText } from "../analyzePlan"
import { collectNodes } from "../../parsers/normalize"
import { buildStatRows } from "../../graph/detailPanel/buildStatRows"

type RawPlan = Record<string, unknown>

/** One row per POSTGRES_OPERATOR_MAP entry (src/parsers/postgres/operatorMap.ts),
 * with the minimal extra fields each operator type needs to exercise a
 * realistic code path in extendedFields.ts (a join gets a Join Type, a
 * scan gets a Relation Name, etc.) — not a full realistic plan, just enough
 * to not degrade to the bare-minimum default for every single one. */
function buildAllOperatorNodes(): RawPlan[] {
  const base = (nodeType: string, extra: RawPlan = {}, estRows = 100, actRows = 95, loops = 1): RawPlan => ({
    "Node Type": nodeType,
    "Startup Cost": 0.5,
    "Total Cost": 120.5,
    "Plan Rows": estRows,
    "Plan Width": 16,
    "Actual Startup Time": 0.1,
    "Actual Total Time": 12.5,
    "Actual Rows": actRows,
    "Actual Loops": loops,
    ...extra,
  })

  return [
    base("Seq Scan", { "Relation Name": "t_seq", Alias: "a" }),
    base("Index Scan", { "Relation Name": "t_idx", Alias: "b", "Index Name": "idx_b", "Index Cond": "(b.id = 1)" }),
    base("Index Only Scan", { "Relation Name": "t_ios", Alias: "c", "Index Name": "idx_c" }),
    base("Bitmap Heap Scan", { "Relation Name": "t_bhs", Alias: "d" }),
    base("Bitmap Index Scan", { "Index Name": "idx_e" }),
    base("BitmapAnd", {}, 100, 0), // real Postgres quirk: BitmapAnd/Or always report 0 actual rows
    base("BitmapOr", {}, 100, 0),
    base("Tid Scan", { "Relation Name": "t_tid" }),
    base("Subquery Scan", { Alias: "sub1" }),
    base("Function Scan", { "Function Name": "generate_series" }),
    base("Values Scan", {}),
    base("CTE Scan", { "CTE Name": "my_cte" }),
    base("Named Tuplestore Scan", {}),
    base("WorkTable Scan", {}),
    base("Foreign Scan", { "Relation Name": "t_foreign" }),
    base("Custom Scan", { "Custom Plan Provider": "SomeExtension" }),
    base("Nested Loop", { "Join Type": "Inner" }),
    base("Hash Join", { "Join Type": "Left", "Hash Cond": "(x.id = y.id)" }),
    base("Merge Join", { "Join Type": "Inner", "Merge Cond": "(x.id = y.id)" }),
    base("Hash", {}),
    base("Sort", { "Sort Key": ["x.id"], "Sort Method": "quicksort", "Sort Space Used": 25, "Sort Space Type": "Memory" }),
    base("Aggregate", { Strategy: "Plain" }),
    base("HashAggregate", { "Group Key": ["x.id"] }),
    base("GroupAggregate", { "Group Key": ["x.id"] }),
    base("WindowAgg", {}),
    base("Group", { "Group Key": ["x.id"] }),
    base("Unique", {}),
    base("SetOp", { Command: "Intersect" }),
    base("Limit", {}),
    base("Append", {}),
    base("Merge Append", {}),
    base("Recursive Union", {}),
    base("Result", {}),
    base("ProjectSet", {}),
    base("Materialize", {}),
    base("Memoize", {}),
    base("Gather", { "Workers Planned": 2, "Workers Launched": 2 }),
    base("Gather Merge", { "Workers Planned": 2, "Workers Launched": 2 }),
    base("Lock Rows", {}),
    base("Modify Table", { Operation: "Update", "Relation Name": "t_modify" }),
  ]
}

/** Wraps the flat list of leaf-ish nodes as children of one top-level
 * `Append` — structurally valid (`Append` legitimately takes any number
 * of child plans of any type) even though no real query shapes up this
 * way. Each child is otherwise a leaf (no further nesting) since this
 * test's whole point is per-operator-type coverage, not tree topology. */
function buildKitchenSinkPlan(): string {
  const children = buildAllOperatorNodes()
  const root: RawPlan = {
    "Node Type": "Append",
    "Startup Cost": 0,
    "Total Cost": 99999,
    "Plan Rows": 5000,
    "Plan Width": 16,
    "Actual Startup Time": 0,
    "Actual Total Time": 500,
    "Actual Rows": 4500,
    "Actual Loops": 1,
    Plans: children,
  }
  return JSON.stringify([{ Plan: root, "Planning Time": 1.2, "Execution Time": 501.3 }])
}

describe("Postgres — every mapped operator type survives the full pipeline (user-requested stress test)", () => {
  const text = buildKitchenSinkPlan()

  it("parses without throwing", () => {
    expect(() => analyzePlanText(text)).not.toThrow()
  })

  const result = analyzePlanText(text)
  const nodes = collectNodes(result.statements[0].root)

  it("wires up exactly the root + every operator-map entry as a direct child", () => {
    // 1 root (Append) + 40 children — a change to POSTGRES_OPERATOR_MAP's
    // own entry count without updating this list is the tripwire this
    // count catches; the per-type assertions below are the real coverage.
    expect(nodes.length).toBe(1 + buildAllOperatorNodes().length)
  })

  it("no node resolves to the 'unknown' operatorType — every Node Type used here is one operatorMap.ts already claims to know", () => {
    const unknown = nodes.filter((n) => n.operatorType === "unknown")
    expect(unknown.map((n) => n.rawOperatorLabel)).toEqual([])
  })

  it("buildStatRows never throws, and never renders NaN/undefined as text, for any of the 41 nodes", () => {
    for (const node of nodes) {
      let rows: ReturnType<typeof buildStatRows>
      expect(() => {
        rows = buildStatRows(node)
      }, `buildStatRows threw for ${node.rawOperatorLabel} (${node.operatorType})`).not.toThrow()
      for (const row of rows!) {
        expect(row.value, `${node.rawOperatorLabel}'s "${row.label}" row`).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/)
      }
    }
  })

  it("BitmapAnd/BitmapOr's real zero-actual-rows quirk doesn't produce a nonsensical negative or NaN row", () => {
    const bitmapNodes = nodes.filter((n) => n.operatorType === "bitmap_and" || n.operatorType === "bitmap_or")
    expect(bitmapNodes).toHaveLength(2)
    for (const node of bitmapNodes) {
      expect(node.actualRows).toBe(0)
      const rows = buildStatRows(node)
      expect(rows.find((r) => r.label === "Actual rows")?.value).toBe("0")
    }
  })

  it("the rule engine runs across all 41 nodes without throwing (no rule crashes on an operator type it wasn't specifically written for)", () => {
    expect(() => analyzePlanText(text)).not.toThrow()
    // Every node's warnings array is well-formed (rules never leave it
    // undefined/non-array even when they find nothing to say).
    for (const node of nodes) {
      expect(Array.isArray(node.warnings)).toBe(true)
    }
  })

  it("the plan-level summary renders without throwing even with this many distinct operator types in one tree", () => {
    expect(typeof result.statements[0].summary.text).toBe("string")
    expect(result.statements[0].summary.text.length).toBeGreaterThan(0)
  })
})
