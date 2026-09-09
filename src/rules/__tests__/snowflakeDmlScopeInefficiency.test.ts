import { describe, expect, it } from "vitest"
import { MIN_INPUT_ROWS_THRESHOLD, snowflakeDmlScopeInefficiency, UNCHANGED_RATIO_CRITICAL, UNCHANGED_RATIO_WARNING } from "../snowflakeDmlScopeInefficiency"
import { makeContext, makeNode } from "./testHelpers"

function makeDml(operatorType: string, inputRows: number, rowsChanged: number, dmlField: "rowsUpdated" | "rowsDeleted" | "rowsInserted" = "rowsUpdated") {
  const child = makeNode({ engine: "snowflake", actualRows: inputRows })
  return makeNode({
    engine: "snowflake",
    operatorType,
    children: [child],
    dml: { [dmlField]: rowsChanged },
  })
}

describe("snowflakeDmlScopeInefficiency", () => {
  it("fires as warning when most examined rows weren't changed", () => {
    const node = makeDml("update", MIN_INPUT_ROWS_THRESHOLD, MIN_INPUT_ROWS_THRESHOLD * (1 - UNCHANGED_RATIO_WARNING))
    const warnings = snowflakeDmlScopeInefficiency(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("dml-scope-inefficiency")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical at the higher unchanged-ratio threshold", () => {
    const node = makeDml("delete", MIN_INPUT_ROWS_THRESHOLD, MIN_INPUT_ROWS_THRESHOLD * (1 - UNCHANGED_RATIO_CRITICAL))
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("does not fire when most examined rows WERE changed (well-targeted DML)", () => {
    const node = makeDml("update", MIN_INPUT_ROWS_THRESHOLD, MIN_INPUT_ROWS_THRESHOLD * 0.5)
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the input-rows materiality floor", () => {
    const node = makeDml("update", MIN_INPUT_ROWS_THRESHOLD - 1, 1)
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("handles a Merge summing insert+update+delete counts together", () => {
    const child = makeNode({ engine: "snowflake", actualRows: MIN_INPUT_ROWS_THRESHOLD })
    const node = makeNode({
      engine: "snowflake",
      operatorType: "merge",
      children: [child],
      dml: { rowsInserted: 100, rowsUpdated: 200, rowsDeleted: 50 },
    })
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire for Insert (deliberately out of scope)", () => {
    const node = makeDml("insert", MIN_INPUT_ROWS_THRESHOLD, 10, "rowsInserted")
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not fire for Unload (no rows 'changed' concept)", () => {
    const child = makeNode({ engine: "snowflake", actualRows: MIN_INPUT_ROWS_THRESHOLD })
    const node = makeNode({ engine: "snowflake", operatorType: "unload", children: [child], dml: { rowsUnloaded: 10 } })
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeDml("update", MIN_INPUT_ROWS_THRESHOLD, 10)
    node.engine = "postgres"
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not fire when dml stats are absent", () => {
    const child = makeNode({ engine: "snowflake", actualRows: MIN_INPUT_ROWS_THRESHOLD })
    const node = makeNode({ engine: "snowflake", operatorType: "update", children: [child] })
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not throw when children have no row counts", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "update", dml: { rowsUpdated: 10 }, children: [makeNode({ engine: "snowflake" })] })
    expect(() => snowflakeDmlScopeInefficiency(node, makeContext(node))).not.toThrow()
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })

  it("does not fire when rowsChanged exceeds input rows (not an honest comparison)", () => {
    const node = makeDml("update", MIN_INPUT_ROWS_THRESHOLD, MIN_INPUT_ROWS_THRESHOLD + 500)
    expect(snowflakeDmlScopeInefficiency(node, makeContext(node))).toEqual([])
  })
})
