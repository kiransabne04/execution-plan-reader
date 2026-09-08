import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { applyRules } from "../index"
import { computeQueryHealth } from "../queryHealth"
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
      attributes: { "Object.Table": "[T]" },
      spill: { occurred: true },
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
    // sqlserver-sort-spill coexists with the generic disk-spill finding —
    // this fixture's real SpillLevel="1" attribute, parsed all the way
    // through, not a hand-assembled node.
    expect(stmt.root.warnings.some((w) => w.ruleId === "sqlserver-sort-spill")).toBe(true)
  })

  it("end-to-end: SQL Server excessive-memory-grant fixture fires memory-grant-excessive and memory-grant-feedback", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "memory-grant-excessive.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    expect(stmt.root.warnings.some((w) => w.ruleId === "memory-grant-excessive")).toBe(true)
    expect(stmt.root.warnings.some((w) => w.ruleId === "memory-grant-feedback")).toBe(true)
    // This fixture has no spill anywhere — real proof the memory-grant
    // finding above isn't quietly excluded by Query Health's own
    // eligibility gate for the "memory" dimension.
    const health = computeQueryHealth(stmt.root, context)
    expect(health.dimensions.memory.status).toBe("scored")
  })

  it("end-to-end: SQL Server memory-grant-pressure fixture correlates a modest grant with a real spill", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "memory-grant-pressure.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    expect(stmt.root.warnings.some((w) => w.ruleId === "memory-grant-pressure")).toBe(true)
    // This fixture's MemoryGrantInfo has no IsMemoryGrantFeedbackAdjusted
    // attribute at all — must not fabricate a feedback finding.
    expect(stmt.root.warnings.some((w) => w.ruleId === "memory-grant-feedback")).toBe(false)
  })

  it("end-to-end: SQL Server hash-join fixture (no spill) never fires sqlserver-hash-spill", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "hash-join.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    expect(collectNodes(stmt.root).flatMap((n) => n.warnings).some((w) => w.ruleId === "sqlserver-hash-spill")).toBe(false)
  })

  it("end-to-end: SQL Server table-spool-expensive fixture fires on the real Spool node, critical (rebind-dominated)", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "table-spool-expensive.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    const finding = collectNodes(stmt.root).flatMap((n) => n.warnings).find((w) => w.ruleId === "table-spool-expensive")
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe("critical")
  })

  it("end-to-end: SQL Server index-spool-repeated fixture fires on the real Index Spool node, warning (rewind-dominated)", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "index-spool-repeated.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    const finding = collectNodes(stmt.root).flatMap((n) => n.warnings).find((w) => w.ruleId === "index-spool-repeated")
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe("warning")
  })

  it("end-to-end: SQL Server parallel-thread-skew fixture fires through the real parser and ancestry", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "parallel-thread-skew.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    expect(collectNodes(stmt.root).flatMap((n) => n.warnings).some((w) => w.ruleId === "parallel-thread-skew")).toBe(true)
  })

  it("end-to-end: SQL Server exchange-data-movement fixture fires exchange-data-movement and execution-mode together", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "exchange-data-movement.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    const warnings = collectNodes(stmt.root).flatMap((n) => n.warnings)
    expect(warnings.some((w) => w.ruleId === "exchange-data-movement")).toBe(true)
    expect(warnings.some((w) => w.ruleId === "execution-mode")).toBe(true)
  })

  it("end-to-end: SQL Server adaptive-join fixture fires adaptive-join and correctly names the executed branch", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "adaptive-join.xml"))
    const [stmt] = statements
    const context = buildPlanContext(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes })
    applyRules(stmt.root, context)
    const finding = stmt.root.warnings.find((w) => w.ruleId === "adaptive-join")
    expect(finding).toBeDefined()
    expect(finding?.longText).toContain("Hash Match branch is the one that ran")
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

  // Episode 30 — this real fixture scans 100% of 84,213 partitions (a full
  // scan, no pruning at all) and 9.8TB — both poor-partition-pruning and
  // large-scan-volume should fire through the real Snowflake parser, not
  // just a hand-assembled node.
  it("end-to-end: Snowflake high-partition-count fixture fires poor-partition-pruning and large-scan-volume", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("snowflake", "high-partition-count-scan.json"))
    applyRules(root, buildPlanContext(root))
    expect(root.warnings.some((w) => w.ruleId === "poor-partition-pruning")).toBe(true)
    expect(root.warnings.some((w) => w.ruleId === "large-scan-volume")).toBe(true)

    const health = computeQueryHealth(root, buildPlanContext(root))
    // Real proof the cardinality-dimension eligibility fix actually works —
    // Snowflake never populates estimatedRows, so without that fix this
    // would misreport "insufficient data" despite carrying real findings.
    expect(health.dimensions.cardinality.status).toBe("scored")
  })

  it("end-to-end: SQL Server parallelism fixture does not misfire high-loop-count on cumulated thread time", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "parallelism-multi-thread.xml"))
    const root = statements[0].root
    applyRules(root, buildPlanContext(root))
    expect(collectNodes(root).every((n) => !n.warnings.some((w) => w.ruleId === "high-loop-count"))).toBe(true)
  })
})
