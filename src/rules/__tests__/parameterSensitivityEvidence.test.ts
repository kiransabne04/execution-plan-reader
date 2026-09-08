import { describe, expect, it } from "vitest"
import { applyRules } from "../index"
import { enhanceParameterSensitivityNote } from "../parameterSensitivityEvidence"
import { buildPlanContext } from "../types"
import { makeNode } from "./testHelpers"

const RULE_ID = "parameter-sensitivity-honesty-note"

function makeParamNode(overrides: Parameters<typeof makeNode>[0] = {}) {
  return makeNode({ engine: "sqlserver", ...overrides })
}

describe("enhanceParameterSensitivityNote", () => {
  it("is a no-op when the baseline note never fired at all (no parameter marker in the statement)", () => {
    const root = makeParamNode({ operatorType: "seq_scan" })
    const context = buildPlanContext(root, { statementText: "SELECT * FROM Orders" })
    applyRules(root, context)
    expect(() => enhanceParameterSensitivityNote(root, context)).not.toThrow()
    expect(root.warnings.find((w) => w.ruleId === RULE_ID)).toBeUndefined()
  })

  it("stays info with zero corroborating signals", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 100, actualRows: 105 })
    const context = buildPlanContext(root, { statementText: "SELECT * FROM Orders WHERE Id = @Id" })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    const finding = root.warnings.find((w) => w.ruleId === RULE_ID)
    expect(finding?.severity).toBe("info")
  })

  it("stays info with only ONE corroborating signal (materially-differing parameter alone)", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 100, actualRows: 105 })
    const context = buildPlanContext(root, {
      statementText: "SELECT * FROM Orders WHERE Id = @Id",
      parameters: [{ name: "@Id", compiledValue: "1", runtimeValue: "42" }],
    })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    expect(root.warnings.find((w) => w.ruleId === RULE_ID)?.severity).toBe("info")
  })

  it("escalates to warning with 2 signals: differing parameter + a large cardinality mismatch", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const context = buildPlanContext(root, {
      statementText: "SELECT * FROM Orders WHERE Id = @Id",
      parameters: [{ name: "@Id", compiledValue: "1", runtimeValue: "42" }],
    })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    const finding = root.warnings.find((w) => w.ruleId === RULE_ID)
    expect(finding?.severity).toBe("warning")
    expect(finding?.longText).toContain("@Id")
    expect(finding?.longText).toContain("worth investigating")
  })

  it("escalates to warning with 2 signals: large cardinality mismatch + a real propagation relationship", () => {
    // scan (bad-row-estimate, the cause) is a DESCENDANT of aggregate
    // (high-loop-count, the effect) — real propagation evidence from
    // cardinalityPropagation.ts, not fabricated. Engine-agnostic
    // high-loop-count used (not nested-loop-explosion) so this stays a
    // pure SQL Server scenario throughout, matching how this feature
    // actually ships.
    const scan = makeNode({ id: "scan", engine: "sqlserver", operatorType: "seq_scan", estimatedRows: 10, actualRows: 40_000 })
    const aggregate = makeNode({ id: "aggregate", engine: "sqlserver", operatorType: "aggregate", loops: 2_000, actualTimeMs: 2, children: [scan] })
    const root = makeNode({ id: "root", engine: "sqlserver", operatorType: "compute_scalar", children: [aggregate] })
    const context = buildPlanContext(root, { statementText: "SELECT * FROM Orders WHERE Id = @Id" })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    const finding = root.warnings.find((w) => w.ruleId === RULE_ID)
    expect(finding?.severity).toBe("warning")
    expect(finding?.longText).toContain("propagated")
  })

  it("never claims 'parameter sniffing confirmed', even at maximum confidence", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const context = buildPlanContext(root, {
      statementText: "SELECT * FROM Orders WHERE Id = @Id",
      parameters: [{ name: "@Id", compiledValue: "1", runtimeValue: "42" }],
    })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    const longText = root.warnings.find((w) => w.ruleId === RULE_ID)?.longText ?? ""
    expect(longText.toLowerCase()).not.toContain("parameter sniffing confirmed")
    expect(longText).toContain("isn't a confirmed diagnosis")
  })

  it("treats a quoted-vs-unquoted or case-different value as NOT materially differing", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const context = buildPlanContext(root, {
      statementText: "SELECT * FROM Orders WHERE Status = @Status",
      parameters: [{ name: "@Status", compiledValue: "'Active'", runtimeValue: "'active'" }],
    })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    // Only 1 real signal (cardinality mismatch) since the parameter values
    // normalize to the same thing — stays info.
    expect(root.warnings.find((w) => w.ruleId === RULE_ID)?.severity).toBe("info")
  })

  it("re-sorts root.warnings by severity after escalating, so the note isn't stranded among the info tier", () => {
    const root = makeParamNode({ operatorType: "seq_scan", estimatedRows: 10, actualRows: 50_000 })
    const context = buildPlanContext(root, {
      statementText: "SELECT * FROM Orders WHERE Id = @Id",
      parameters: [{ name: "@Id", compiledValue: "1", runtimeValue: "42" }],
    })
    applyRules(root, context)
    enhanceParameterSensitivityNote(root, context)
    const severities = root.warnings.map((w) => w.severity)
    const ranks: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    for (let i = 1; i < severities.length; i++) {
      expect(ranks[severities[i]]).toBeGreaterThanOrEqual(ranks[severities[i - 1]])
    }
  })
})
