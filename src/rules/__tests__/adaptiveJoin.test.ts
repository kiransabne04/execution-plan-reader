import { describe, expect, it } from "vitest"
import { adaptiveJoin, CANNOT_CONFIRM_BRANCH_TEXT } from "../adaptiveJoin"
import { makeContext, makeNode } from "./testHelpers"

describe("adaptiveJoin", () => {
  it("fires info and names the executed branch when exactly one child has real execution data", () => {
    const executed = makeNode({ rawOperatorLabel: "Hash Match", actualRows: 48_000, actualTimeMs: 850 })
    const notExecuted = makeNode({ rawOperatorLabel: "Nested Loops" }) // no actual data at all
    const node = makeNode({ engine: "sqlserver", operatorType: "adaptive_join", children: [executed, notExecuted] })
    const warnings = adaptiveJoin(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("adaptive-join")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].longText).toContain("Hash Match branch is the one that ran")
  })

  it("uses the required fallback sentence verbatim when both children show execution data", () => {
    const a = makeNode({ rawOperatorLabel: "Hash Match", actualRows: 100 })
    const b = makeNode({ rawOperatorLabel: "Nested Loops", actualRows: 50 })
    const node = makeNode({ engine: "sqlserver", operatorType: "adaptive_join", children: [a, b] })
    const longText = adaptiveJoin(node, makeContext(node))[0].longText
    expect(longText).toContain(CANNOT_CONFIRM_BRANCH_TEXT)
  })

  it("uses the required fallback sentence verbatim when neither child shows execution data (estimate-only)", () => {
    const a = makeNode({ rawOperatorLabel: "Hash Match" })
    const b = makeNode({ rawOperatorLabel: "Nested Loops" })
    const node = makeNode({ engine: "sqlserver", operatorType: "adaptive_join", children: [a, b] })
    const longText = adaptiveJoin(node, makeContext(node))[0].longText
    expect(longText).toContain(CANNOT_CONFIRM_BRANCH_TEXT)
  })

  it("uses the fallback sentence when fewer than 2 children are present, without throwing", () => {
    const only = makeNode({ rawOperatorLabel: "Hash Match", actualRows: 100 })
    const node = makeNode({ engine: "sqlserver", operatorType: "adaptive_join", children: [only] })
    expect(() => adaptiveJoin(node, makeContext(node))).not.toThrow()
    expect(adaptiveJoin(node, makeContext(node))[0].longText).toContain(CANNOT_CONFIRM_BRANCH_TEXT)
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const a = makeNode({ actualRows: 100 })
    const b = makeNode({})
    const node = makeNode({ engine: "postgres", operatorType: "adaptive_join", children: [a, b] })
    expect(adaptiveJoin(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on an unrelated operator type", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "hash_join" })
    expect(adaptiveJoin(node, makeContext(node))).toEqual([])
  })

  it("explains the mechanism as purely informational, never a problem on its own", () => {
    const a = makeNode({ rawOperatorLabel: "Hash Match", actualRows: 100 })
    const b = makeNode({ rawOperatorLabel: "Nested Loops" })
    const node = makeNode({ engine: "sqlserver", operatorType: "adaptive_join", children: [a, b] })
    const longText = adaptiveJoin(node, makeContext(node))[0].longText
    expect(longText).toContain("isn't itself a problem")
  })
})
