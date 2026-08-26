// Episode 4, Story 4.1 — cross-engine taxonomy invariant. Every parser's
// operator map is unit-tested in isolation already; this suite is the
// "solidify" check the story's testing approach asks for: sweep the WHOLE
// real fixture library across all three engines and assert the shared
// contract holds everywhere at once, not just per-fixture.
//
// See .claude/skills/plan-normalization/SKILL.md.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { collectNodes, type PlanNode } from "../normalize"
import { parsePostgresJsonPlan } from "../postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../postgres/textParser"
import { parseSqlServerShowplanXml } from "../sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../snowflake"

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures")

function readFixtureDir(engine: string): Array<{ name: string; text: string }> {
  const dir = path.join(FIXTURES_ROOT, engine)
  return readdirSync(dir).map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf-8") }))
}

/**
 * Every root successfully parsed out of the real fixture library, across all
 * three engines. Fixtures that are deliberately invalid (truncated/malformed/
 * non-plan-text/empty-result — each already covered by its own parser's test
 * file) simply throw here and are skipped: this suite is only about what a
 * *successfully parsed* tree looks like, not about error handling.
 */
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

interface UnmappedLabel {
  engine: string
  rawOperatorLabel: string
}

/**
 * The running list the plan-normalization skill asks for: every (engine,
 * rawOperatorLabel) pair that resolves to "unknown" anywhere in the real
 * fixture library. Empty today — every operator type our own fixtures
 * exercise is mapped. If this test fails with a new entry, that's a real
 * gap: either extend the relevant operatorMap.ts, or, if the label
 * genuinely has no normalized home yet, add it here deliberately so the
 * gap stays visible instead of silently passing.
 */
const ACCEPTED_UNKNOWN_LABELS: UnmappedLabel[] = []

describe("operator taxonomy (cross-engine)", () => {
  const roots = collectAllFixtureRoots()

  it("sanity check: this suite actually parsed fixtures from all three engines", () => {
    expect(new Set(roots.map((r) => r.engine))).toEqual(new Set(["postgres", "sqlserver", "snowflake"]))
    expect(roots.length).toBeGreaterThan(10)
  })

  it("every node in every real fixture keeps rawOperatorLabel, operatorType, and attributes intact", () => {
    for (const root of roots) {
      for (const node of collectNodes(root)) {
        expect(node.rawOperatorLabel.length).toBeGreaterThan(0)
        expect(node.operatorType.length).toBeGreaterThan(0)
        expect(node.attributes).toBeTypeOf("object")
        expect(node.warnings).toEqual([])
      }
    }
  })

  it("tracks every 'unknown' operatorType seen in the fixture library against an explicit accepted list", () => {
    const seen = new Set<string>()
    const unmapped: UnmappedLabel[] = []
    for (const root of roots) {
      for (const node of collectNodes(root)) {
        if (node.operatorType !== "unknown") continue
        const key = `${root.engine}::${node.rawOperatorLabel}`
        if (seen.has(key)) continue
        seen.add(key)
        unmapped.push({ engine: root.engine, rawOperatorLabel: node.rawOperatorLabel })
      }
    }
    expect(unmapped).toEqual(ACCEPTED_UNKNOWN_LABELS)
  })
})
