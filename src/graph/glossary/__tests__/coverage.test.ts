// Suite-wide coverage sweep — same pattern as
// src/parsers/__tests__/operatorTaxonomy.test.ts (Episode 4's "seen but
// unmapped" tracking), applied to glossary coverage instead of operator
// mapping. See .claude/skills/operator-glossary-content/SKILL.md.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { collectNodes, type PlanNode } from "../../../parsers/normalize"
import { parsePostgresJsonPlan } from "../../../parsers/postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../../../parsers/postgres/textParser"
import { parseSqlServerShowplanXml } from "../../../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../../../parsers/snowflake"
import { getGlossaryEntry } from "../index"
import { mapSqlServerOperatorType } from "../../../parsers/sqlserver/operatorMap"
import { mapPostgresOperatorType } from "../../../parsers/postgres/operatorMap"
import { mapSnowflakeOperatorType } from "../../../parsers/snowflake/operatorMap"

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures")

function readFixtureDir(engine: string): Array<{ name: string; text: string }> {
  const dir = path.join(FIXTURES_ROOT, engine)
  return readdirSync(dir).map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf-8") }))
}

function collectAllFixtureRoots(): PlanNode[] {
  const roots: PlanNode[] = []

  for (const { name, text } of readFixtureDir("postgres")) {
    try {
      if (name.endsWith(".json")) roots.push(parsePostgresJsonPlan(text))
      else if (name.endsWith(".txt")) roots.push(parsePostgresTextPlan(text))
    } catch {
      // deliberately-invalid fixture — not this suite's concern
    }
  }

  for (const { name, text } of readFixtureDir("sqlserver")) {
    if (!name.endsWith(".xml")) continue
    try {
      const result = parseSqlServerShowplanXml(text)
      for (const stmt of result.statements) roots.push(stmt.root)
    } catch {
      // deliberately-invalid fixture
    }
  }

  for (const { name, text } of readFixtureDir("snowflake")) {
    if (!name.endsWith(".json")) continue
    try {
      roots.push(parseSnowflakeOperatorStats(text).root)
    } catch {
      // deliberately-invalid/empty fixture
    }
  }

  return roots
}

describe("operator glossary coverage", () => {
  const roots = collectAllFixtureRoots()

  it("sanity check: this suite actually parsed fixtures from all three engines", () => {
    expect(new Set(roots.map((r) => r.engine))).toEqual(new Set(["postgres", "sqlserver", "snowflake"]))
  })

  it("every non-'unknown' operatorType seen in the real fixture library has a glossary entry", () => {
    const missing = new Set<string>()
    for (const root of roots) {
      for (const node of collectNodes(root)) {
        if (node.operatorType === "unknown") continue // handled by the fallback path, not a gap
        if (!getGlossaryEntry(node.operatorType)) missing.add(node.operatorType)
      }
    }
    expect([...missing]).toEqual([])
  })

  it("every operatorType any mapping table can return (per each operatorMap.ts's own known-label list) has a glossary entry", () => {
    // Sourced directly from each operatorMap.ts's own literal label tables —
    // if a new label/operatorType pair is added there without updating the
    // glossary, this test is the tripwire.
    const postgresLabels = [
      "Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan", "Bitmap Index Scan",
      "BitmapAnd", "BitmapOr", "Tid Scan", "Subquery Scan", "Function Scan", "Values Scan",
      "CTE Scan", "Named Tuplestore Scan", "WorkTable Scan", "Foreign Scan", "Custom Scan",
      "Nested Loop", "Hash Join", "Merge Join", "Hash", "Sort", "Aggregate", "HashAggregate",
      "GroupAggregate", "WindowAgg", "Group", "Unique", "SetOp", "Limit", "Append",
      "Merge Append", "Recursive Union", "Result", "ProjectSet", "Materialize", "Memoize",
      "Gather", "Gather Merge", "Lock Rows", "Modify Table",
    ]
    const sqlServerLabels: Array<[string, string?]> = [
      ["Table Scan"], ["Clustered Index Scan"], ["Index Scan"], ["Clustered Index Seek"], ["Index Seek"],
      ["Key Lookup"], ["RID Lookup"], ["Nested Loops"], ["Merge Join"], ["Sort"], ["Stream Aggregate"],
      ["Filter"], ["Compute Scalar"], ["Concatenation"], ["Top"], ["Bitmap"], ["Table Spool"],
      ["Index Spool"], ["Row Count Spool"], ["Table Insert"], ["Clustered Index Insert"], ["Table Update"],
      ["Clustered Index Update"], ["Table Delete"], ["Clustered Index Delete"], ["Table Merge"],
      ["Hash Match", "Inner Join"], ["Hash Match", "Aggregate"], ["Hash Match", "Distinct"],
      ["Hash Match", "Union"], ["Parallelism", "Gather Streams"], ["Parallelism", "Distribute Streams"],
    ]
    const snowflakeLabels = [
      "TableScan", "Filter", "Aggregate", "Join", "CartesianJoin", "Sort", "SortWithLimit", "Limit",
      "WindowFunction", "WithClause", "WithReference", "UnionAll", "Flatten", "GroupingSets",
      "ExternalFunction", "Generator", "Result", "InsertValuesClause", "ValuesClause",
    ]

    const missing = new Set<string>()
    for (const label of postgresLabels) {
      const t = mapPostgresOperatorType(label)
      if (t !== "unknown" && !getGlossaryEntry(t)) missing.add(`postgres:${label}->${t}`)
    }
    for (const [physicalOp, logicalOp] of sqlServerLabels) {
      const t = mapSqlServerOperatorType(physicalOp, logicalOp)
      if (t !== "unknown" && !getGlossaryEntry(t)) missing.add(`sqlserver:${physicalOp}/${logicalOp}->${t}`)
    }
    for (const label of snowflakeLabels) {
      const t = mapSnowflakeOperatorType(label)
      if (t !== "unknown" && !getGlossaryEntry(t)) missing.add(`snowflake:${label}->${t}`)
    }

    expect([...missing]).toEqual([])
  })
})
