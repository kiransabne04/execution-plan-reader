import { describe, expect, it } from "vitest"
import { executionMode } from "../executionMode"
import { makeContext, makeNode } from "./testHelpers"

describe("executionMode", () => {
  it("fires info when ActualExecutionMode is Batch", () => {
    const node = makeNode({ engine: "sqlserver", rawOperatorLabel: "Hash Match", attributes: { ActualExecutionMode: "Batch" } })
    const warnings = executionMode(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("execution-mode")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].shortText).toContain("Batch mode")
  })

  it("does NOT fire when ActualExecutionMode is Row", () => {
    const node = makeNode({ engine: "sqlserver", attributes: { ActualExecutionMode: "Row" } })
    expect(executionMode(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when the attribute is absent entirely", () => {
    const node = makeNode({ engine: "sqlserver" })
    expect(() => executionMode(node, makeContext(node))).not.toThrow()
    expect(executionMode(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine even with the attribute present", () => {
    const node = makeNode({ engine: "postgres", attributes: { ActualExecutionMode: "Batch" } })
    expect(executionMode(node, makeContext(node))).toEqual([])
  })

  it("never escalates beyond info, and never claims batch mode is better or worse", () => {
    const node = makeNode({ engine: "sqlserver", attributes: { ActualExecutionMode: "Batch" } })
    const warnings = executionMode(node, makeContext(node))
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].longText).toContain("no warning is raised here")
  })
})
