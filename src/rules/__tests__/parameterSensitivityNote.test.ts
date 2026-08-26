import { describe, expect, it } from "vitest"
import { parameterSensitivityNote } from "../parameterSensitivityNote"
import { makeContext, makeNode } from "./testHelpers"

describe("parameterSensitivityNote", () => {
  it("attaches the honesty note when the SQL Server statement text uses a parameter marker", () => {
    const root = makeNode({ engine: "sqlserver" })
    const context = makeContext(root, { statementText: "SELECT * FROM Orders WHERE CustomerId = @CustomerId" })
    const warnings = parameterSensitivityNote(root, context)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("parameter-sensitivity-honesty-note")
    expect(warnings[0].severity).toBe("info")
  })

  it("does NOT fire on a SQL Server statement with no parameter markers", () => {
    const root = makeNode({ engine: "sqlserver" })
    const context = makeContext(root, { statementText: "SELECT * FROM Orders WHERE CustomerId = 42" })
    expect(parameterSensitivityNote(root, context)).toEqual([])
  })

  it("attaches the honesty note when a Postgres node references an InitPlan-computed placeholder", () => {
    const child = makeNode({ engine: "postgres", attributes: { Filter: "(total > $0)" } })
    const root = makeNode({ engine: "postgres", children: [child] })
    expect(parameterSensitivityNote(root, makeContext(root))).toHaveLength(1)
  })

  it("does NOT fire on a Postgres plan with no parameter placeholders", () => {
    const child = makeNode({ engine: "postgres", attributes: { Filter: "(total > 100)" } })
    const root = makeNode({ engine: "postgres", children: [child] })
    expect(parameterSensitivityNote(root, makeContext(root))).toEqual([])
  })

  it("this is a disclosure, not a diagnosis — text never claims to detect sniffing itself", () => {
    const root = makeNode({ engine: "sqlserver" })
    const context = makeContext(root, { statementText: "WHERE Id = @Id" })
    const [warning] = parameterSensitivityNote(root, context)
    expect(warning.longText.toLowerCase()).not.toContain("sniffing")
    expect(warning.longText).toContain("can't show you")
  })

  it("only fires once, on the root node", () => {
    const root = makeNode({ engine: "sqlserver" })
    const child = makeNode({ engine: "sqlserver" })
    const context = makeContext(root, { statementText: "WHERE Id = @Id" })
    expect(parameterSensitivityNote(child, context)).toEqual([])
  })
})
