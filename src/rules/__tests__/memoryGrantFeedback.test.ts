import { describe, expect, it } from "vitest"
import { memoryGrantFeedback } from "../memoryGrantFeedback"
import { makeContext, makeNode } from "./testHelpers"

describe("memoryGrantFeedback", () => {
  it("does NOT fire when memoryGrant is entirely absent", () => {
    const node = makeNode({ engine: "sqlserver" })
    expect(() => memoryGrantFeedback(node, makeContext(node))).not.toThrow()
    expect(memoryGrantFeedback(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when memoryGrant exists but the feedback marker specifically is absent", () => {
    const node = makeNode({ engine: "sqlserver", memoryGrant: { grantedKb: 1_000, maxUsedKb: 900 } })
    expect(memoryGrantFeedback(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine even if feedbackAdjusted were somehow set", () => {
    const node = makeNode({ engine: "postgres", memoryGrant: { feedbackAdjusted: "YesStable" } })
    expect(memoryGrantFeedback(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-root node", () => {
    const child = makeNode({ engine: "sqlserver", memoryGrant: { feedbackAdjusted: "YesStable" } })
    const root = makeNode({ engine: "sqlserver", children: [child] })
    expect(memoryGrantFeedback(child, makeContext(root))).toEqual([])
  })

  it("fires at info severity when the marker is present, and surfaces it as pure information", () => {
    const node = makeNode({ engine: "sqlserver", memoryGrant: { feedbackAdjusted: "YesStable" } })
    const warnings = memoryGrantFeedback(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("memory-grant-feedback")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].shortText).toContain("YesStable")
    expect(warnings[0].longText).toContain("purely informational")
  })

  it("maps each known value to a plain-language explanation", () => {
    for (const value of ["YesStable", "YesAdjusting", "NoFirstExecution", "NoFeedback"]) {
      const node = makeNode({ engine: "sqlserver", memoryGrant: { feedbackAdjusted: value } })
      const longText = memoryGrantFeedback(node, makeContext(node))[0].longText
      expect(longText).not.toContain("doesn't have a plain-language explanation")
    }
  })

  it("shows an unrecognized value verbatim rather than dropping or guessing at it", () => {
    const node = makeNode({ engine: "sqlserver", memoryGrant: { feedbackAdjusted: "SomeFutureSqlServerValue" } })
    const warnings = memoryGrantFeedback(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("SomeFutureSqlServerValue")
    expect(warnings[0].longText).toContain("SomeFutureSqlServerValue")
    expect(warnings[0].longText).toContain("doesn't have a plain-language explanation")
  })
})
