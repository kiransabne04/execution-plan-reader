import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { applyRules } from "../index"
import { buildPlanContext } from "../types"
import { collectNodes } from "../../parsers/normalize"
import { parseSqlServerShowplanXml } from "../../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../../parsers/snowflake"
import { makeNode } from "./testHelpers"

function loadFixture(engineDir: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engineDir}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

describe("applyRules", () => {
  it("populates warnings on every node, sorted critical -> warning -> info", () => {
    const child = makeNode({ operatorType: "seq_scan", actualRows: 1_000_000, attributes: { "Relation Name": "t" } })
    const root = makeNode({ operatorType: "hash_join", actualRows: 1, children: [child] })
    applyRules(root, buildPlanContext(root))

    expect(child.warnings).toHaveLength(1)
    expect(child.warnings[0].ruleId).toBe("seq-scan-on-large-table")
  })

  it("does not truncate multiple warnings on the same node — capping is a display concern, not the engine's", () => {
    const node = makeNode({
      operatorType: "seq_scan",
      estimatedRows: 100,
      actualRows: 1_000_000, // triggers both seq-scan-on-large-table AND bad-row-estimate
      attributes: { "Relation Name": "t" },
    })
    applyRules(node, buildPlanContext(node))
    const ruleIds = node.warnings.map((w) => w.ruleId).sort()
    expect(ruleIds).toEqual(["bad-row-estimate", "seq-scan-on-large-table"])
  })

  it("orders warnings by severity when a node triggers rules of different severities", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "seq_scan",
      actualRows: 1_000_000,
      // seq-scan-on-large-table (warning) + disk-spill (critical) on the same node
      attributes: { "Object.Table": "[T]", "Spill Occurred": "true" },
    })
    applyRules(node, buildPlanContext(node))
    expect(node.warnings.map((w) => w.severity)).toEqual(["critical", "warning"])
  })

  it("snapshot: exact warning set produced for a representative multi-issue plan", () => {
    const inner = makeNode({
      id: "scan",
      operatorType: "seq_scan",
      rawOperatorLabel: "Seq Scan",
      estimatedRows: 100,
      actualRows: 500_000,
      attributes: { "Relation Name": "events" },
    })
    const join = makeNode({
      id: "join",
      operatorType: "hash_join",
      rawOperatorLabel: "Hash Join",
      estimatedRows: 100,
      actualRows: 490_000,
      children: [inner, makeNode({ id: "other-side", actualRows: 10 })],
    })
    applyRules(join, buildPlanContext(join))

    const summary = collectNodes(join).map((n) => ({
      id: n.id,
      ruleIds: n.warnings.map((w) => w.ruleId),
    }))
    expect(summary).toMatchSnapshot()
  })

  it("end-to-end: SQL Server spill fixture parses and fires disk-spill via applyRules", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "sort-spill-to-tempdb.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, {
      statementText: stmt.statementText,
      missingIndexes: stmt.missingIndexes,
    })
    applyRules(stmt.root, context)
    expect(stmt.root.warnings.some((w) => w.ruleId === "disk-spill")).toBe(true)
  })

  it("end-to-end: SQL Server missing-index fixture fires missing-index-opportunity on the root", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "missing-index-recommendation.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, {
      statementText: stmt.statementText,
      missingIndexes: stmt.missingIndexes,
    })
    applyRules(stmt.root, context)
    expect(stmt.root.warnings.some((w) => w.ruleId.startsWith("missing-index-opportunity"))).toBe(true)
  })

  it("end-to-end: Snowflake spill fixture parses and fires disk-spill via applyRules", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("snowflake", "spill-to-remote-disk.json"))
    applyRules(root, buildPlanContext(root))
    expect(root.warnings.some((w) => w.ruleId === "disk-spill")).toBe(true)
  })

  it("end-to-end: SQL Server parallelism fixture does not misfire high-loop-count on cumulated thread time", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "parallelism-multi-thread.xml"))
    const root = statements[0].root
    applyRules(root, buildPlanContext(root))
    expect(collectNodes(root).every((n) => !n.warnings.some((w) => w.ruleId === "high-loop-count"))).toBe(true)
  })
})
