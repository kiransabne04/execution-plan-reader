import { describe, expect, it } from "vitest"
import { estimateOnlyNote } from "../estimateOnlyNote"
import { makeContext, makeNode } from "./testHelpers"

describe("estimateOnlyNote", () => {
  it("attaches the note when no node in the tree has actualTimeMs or actualRows (a Postgres EXPLAIN-without-ANALYZE shape)", () => {
    const child = makeNode({ engine: "postgres", estimatedRows: 100, actualRows: undefined, actualTimeMs: undefined })
    const root = makeNode({ engine: "postgres", estimatedRows: 100, actualRows: undefined, actualTimeMs: undefined, children: [child] })
    const warnings = estimateOnlyNote(root, makeContext(root))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("estimate-only-plan")
    expect(warnings[0].severity).toBe("info")
  })

  it("does NOT fire when even one node in the tree has real actual data", () => {
    const child = makeNode({ engine: "postgres", actualRows: 500, actualTimeMs: 1.2 })
    const root = makeNode({ engine: "postgres", actualRows: undefined, actualTimeMs: undefined, children: [child] })
    expect(estimateOnlyNote(root, makeContext(root))).toEqual([])
  })

  it("does NOT fire for Snowflake — its operator-stats output always describes a query that already ran, no 'estimated, not yet executed' capture mode exists", () => {
    const root = makeNode({ engine: "snowflake", actualRows: undefined, actualTimeMs: undefined })
    expect(estimateOnlyNote(root, makeContext(root))).toEqual([])
  })

  it("fires for a SQL Server estimated-plan-only shape the same way it does for Postgres", () => {
    const root = makeNode({ engine: "sqlserver", actualRows: undefined, actualTimeMs: undefined })
    const warnings = estimateOnlyNote(root, makeContext(root))
    expect(warnings).toHaveLength(1)
  })

  it("only fires once, on the root node", () => {
    const root = makeNode({ engine: "postgres", actualRows: undefined, actualTimeMs: undefined })
    const child = makeNode({ engine: "postgres", actualRows: undefined, actualTimeMs: undefined })
    expect(estimateOnlyNote(child, makeContext(root))).toEqual([])
  })

  it("is a disclosure about missing data, not a diagnosis — never implies the plan itself is somehow wrong", () => {
    const root = makeNode({ engine: "postgres", actualRows: undefined, actualTimeMs: undefined })
    const [warning] = estimateOnlyNote(root, makeContext(root))
    expect(warning.longText).toContain("prediction, not a measurement")
  })
})
