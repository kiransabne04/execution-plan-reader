// Episode 18, Story 18.4 — mirrors the taxonomy sweep pattern from
// src/parsers/__tests__/operatorTaxonomy.test.ts: every operatorType seen
// in the real fixture library resolves to either a real icon category or
// the explicit "unknown" fallback, and the unmapped set is tracked
// deliberately, not silently accepted.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { collectNodes, type PlanNode } from "../../parsers/normalize"
import { parsePostgresJsonPlan } from "../../parsers/postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../../parsers/postgres/textParser"
import { parseSqlServerShowplanXml } from "../../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../../parsers/snowflake"
import { operatorIconKey, OPERATOR_ICON_COMPONENT, type OperatorIconKey } from "../operatorIcons"

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures")

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
      // deliberately-invalid fixture
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

// The real operatorType values, drawn from every real fixture, that
// currently have no natural icon fit — see operatorIcons.ts's own comment
// for why each is left unmapped rather than forced into a category it
// doesn't belong to. If this list needs to grow, that's a real, visible
// gap to evaluate — not something to silently swallow into "unknown".
const ACCEPTED_UNMAPPED_OPERATOR_TYPES = [
  "append",
  "bitmap",
  "bitmap_and",
  "compute_scalar",
  "exchange",
  "filter",
  "gather",
  "modify_table",
  "result",
  "unknown",
  "with_clause",
].sort()

describe("operatorIconKey", () => {
  it("maps spec §3's own named examples exactly", () => {
    expect(operatorIconKey("limit")).toBe("limit")
    expect(operatorIconKey("aggregate")).toBe("aggregate")
    expect(operatorIconKey("group_aggregate")).toBe("aggregate")
    expect(operatorIconKey("sort")).toBe("sort")
    expect(operatorIconKey("hash_join")).toBe("join")
    expect(operatorIconKey("merge_join")).toBe("join")
    expect(operatorIconKey("nested_loop_join")).toBe("join")
    expect(operatorIconKey("seq_scan")).toBe("scan")
    expect(operatorIconKey("hash")).toBe("hash")
    expect(operatorIconKey("index_scan")).toBe("index")
    expect(operatorIconKey("index_seek")).toBe("index")
  })

  it("falls back to 'unknown' for a genuinely unmapped operatorType, never crashing or guessing", () => {
    expect(operatorIconKey("some_future_operator_type")).toBe("unknown")
    expect(operatorIconKey("unknown")).toBe("unknown")
  })

  it("has a real icon component for every OperatorIconKey, including the fallback", () => {
    const keys: OperatorIconKey[] = ["limit", "aggregate", "sort", "join", "scan", "hash", "index", "unknown"]
    for (const key of keys) {
      expect(OPERATOR_ICON_COMPONENT[key]).toBeDefined()
    }
  })

  it("hash_join resolves to 'join', not 'hash' — spec §3 groups hash/merge/nested-loop joins together under Join, separately from the standalone Hash operator", () => {
    expect(operatorIconKey("hash_join")).toBe("join")
    expect(operatorIconKey("hash")).toBe("hash")
    expect(operatorIconKey("hash_join")).not.toBe(operatorIconKey("hash"))
  })

  it("tracks every operatorType seen in the real fixture library against an explicit accepted-unmapped list", () => {
    const roots = collectAllFixtureRoots()
    expect(roots.length).toBeGreaterThan(10) // sanity: this suite actually parsed something

    const unmapped = new Set<string>()
    for (const root of roots) {
      for (const node of collectNodes(root)) {
        if (operatorIconKey(node.operatorType) === "unknown") unmapped.add(node.operatorType)
      }
    }
    expect([...unmapped].sort()).toEqual(ACCEPTED_UNMAPPED_OPERATOR_TYPES)
  })
})
