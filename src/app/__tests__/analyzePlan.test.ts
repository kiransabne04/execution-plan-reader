import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { analyzePlanText } from "../analyzePlan"
import { PlanParseError } from "../../parsers/normalize"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

describe("analyzePlanText", () => {
  it("detects and analyzes a Postgres JSON plan", () => {
    const result = analyzePlanText(loadFixture("postgres", "multi-way-join.json"))
    expect(result.engine).toBe("postgres")
    expect(result.statements).toHaveLength(1)
    expect(result.statements[0].root.rawOperatorLabel).toBe("Hash Join")
    expect(result.statements[0].summary.text.length).toBeGreaterThan(0)
  })

  it("detects and analyzes a Postgres TEXT plan", () => {
    const result = analyzePlanText(loadFixture("postgres", "multi-way-join-text.txt"))
    expect(result.engine).toBe("postgres")
    expect(result.statements[0].root.rawOperatorLabel).toBe("Hash Join")
  })

  it("detects and analyzes a SQL Server Showplan XML plan", () => {
    const result = analyzePlanText(loadFixture("sqlserver", "hash-join.xml"))
    expect(result.engine).toBe("sqlserver")
    expect(result.statements[0].root.operatorType).toBe("hash_join")
  })

  it("surfaces every statement in a multi-statement SQL Server batch, not just the first", () => {
    const result = analyzePlanText(loadFixture("sqlserver", "multi-statement-batch.xml"))
    expect(result.engine).toBe("sqlserver")
    expect(result.statements).toHaveLength(2)
    expect(result.statements[0].label).toContain("SELECT * FROM Orders")
    expect(result.statements[1].label).toContain("SELECT * FROM Customers")
  })

  it("runs the rule engine end-to-end for SQL Server, surfacing missing-index findings", () => {
    const result = analyzePlanText(loadFixture("sqlserver", "missing-index-recommendation.xml"))
    const warnings = result.statements[0].root.warnings
    expect(warnings.some((w) => w.ruleId.startsWith("missing-index-opportunity"))).toBe(true)
  })

  it("detects and analyzes a Snowflake operator-stats JSON plan", () => {
    const result = analyzePlanText(loadFixture("snowflake", "join-filter-aggregate.json"))
    expect(result.engine).toBe("snowflake")
    expect(result.statements[0].root.rawOperatorLabel).toBe("Aggregate")
  })

  it("surfaces Snowflake's redacted-query-text flag", () => {
    const result = analyzePlanText(loadFixture("snowflake", "redacted-query-text.json"))
    expect(result.queryTextRedacted).toBe(true)
  })

  it("falls back from Postgres to Snowflake for JSON-shaped input that isn't a Postgres plan", () => {
    const result = analyzePlanText(loadFixture("snowflake", "simple-table-scan.json"))
    expect(result.engine).toBe("snowflake")
  })

  it("throws a friendly, structural error for pasted non-plan text", () => {
    try {
      analyzePlanText(loadFixture("postgres", "non-plan-text.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
    }
  })

  it("propagates a truncation-specific error for a cut-off XML paste", () => {
    try {
      analyzePlanText(loadFixture("sqlserver", "truncated-plan.xml"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("TRUNCATED_INPUT")
    }
  })

  it("throws EMPTY_INPUT for empty/whitespace-only input", () => {
    try {
      analyzePlanText("   ")
      expect.unreachable()
    } catch (err) {
      expect((err as PlanParseError).code).toBe("EMPTY_INPUT")
    }
  })
})
