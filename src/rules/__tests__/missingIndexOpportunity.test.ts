import { describe, expect, it } from "vitest"
import { missingIndexOpportunity } from "../missingIndexOpportunity"
import { makeContext, makeNode } from "./testHelpers"

describe("missingIndexOpportunity", () => {
  it("fires on the root node when the context carries a missing-index recommendation", () => {
    const root = makeNode({ engine: "sqlserver" })
    const context = makeContext(root, {
      missingIndexes: [
        { impact: 87.5, table: "[Orders]", equalityColumns: ["[CustomerId]"], inequalityColumns: [], includedColumns: ["[Total]"] },
      ],
    })
    const warnings = missingIndexOpportunity(root, context)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("Orders")
    expect(warnings[0].shortText).toContain("87.5%")
  })

  it("does NOT fire when there are no missing-index recommendations", () => {
    const root = makeNode({})
    expect(missingIndexOpportunity(root, makeContext(root))).toEqual([])
  })

  it("does not fire on a non-root node, even with recommendations present", () => {
    const root = makeNode({})
    const child = makeNode({})
    const context = makeContext(root, {
      missingIndexes: [{ table: "X", equalityColumns: [], inequalityColumns: [], includedColumns: [] }],
    })
    expect(missingIndexOpportunity(child, context)).toEqual([])
  })

  it("handles multiple recommendations without collapsing them", () => {
    const root = makeNode({})
    const context = makeContext(root, {
      missingIndexes: [
        { table: "A", equalityColumns: ["x"], inequalityColumns: [], includedColumns: [] },
        { table: "B", equalityColumns: ["y"], inequalityColumns: [], includedColumns: [] },
      ],
    })
    expect(missingIndexOpportunity(root, context)).toHaveLength(2)
  })
})
