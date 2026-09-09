import { describe, expect, it } from "vitest"
import { MIN_ROWS_THRESHOLD, snowflakeCartesianJoin } from "../snowflakeCartesianJoin"
import { makeContext, makeNode } from "./testHelpers"

describe("snowflakeCartesianJoin", () => {
  it("fires on Snowflake's explicit CartesianJoin classification above the row floor", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join", rawOperatorLabel: "CartesianJoin", actualRows: 50_000 })
    const warnings = snowflakeCartesianJoin(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("cartesian-join")
    expect(warnings[0].severity).toBe("warning")
  })

  it("mentions Snowflake's own explicit classification, not a volume inference", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join", actualRows: 50_000 })
    const longText = snowflakeCartesianJoin(node, makeContext(node))[0].longText
    expect(longText).toContain("CartesianJoin")
    expect(longText).toContain("not an inference from row volume")
  })

  it("includes input row counts from children when available", () => {
    const left = makeNode({ engine: "snowflake", actualRows: 100 })
    const right = makeNode({ engine: "snowflake", actualRows: 50 })
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join", actualRows: 5_000, children: [left, right] })
    const longText = snowflakeCartesianJoin(node, makeContext(node))[0].longText
    expect(longText).toContain("100")
    expect(longText).toContain("50")
  })

  it("does not fire below the row floor — trivial intentional cross join", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join", actualRows: MIN_ROWS_THRESHOLD - 1 })
    expect(snowflakeCartesianJoin(node, makeContext(node))).toEqual([])
  })

  it("fires exactly at the row floor", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join", actualRows: MIN_ROWS_THRESHOLD })
    expect(snowflakeCartesianJoin(node, makeContext(node))).toHaveLength(1)
  })

  it("does NOT fire on a generic Snowflake join, however large its output — only the explicit CartesianJoin type qualifies", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "join", actualRows: 1_000_000 })
    expect(snowflakeCartesianJoin(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine, even with operatorType cartesian_join", () => {
    const node = makeNode({ engine: "postgres", operatorType: "cartesian_join", actualRows: 50_000 })
    expect(snowflakeCartesianJoin(node, makeContext(node))).toEqual([])
  })

  it("does not throw when row counts are missing", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "cartesian_join" })
    expect(() => snowflakeCartesianJoin(node, makeContext(node))).not.toThrow()
    expect(snowflakeCartesianJoin(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-join operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "table_scan", actualRows: 100_000 })
    expect(snowflakeCartesianJoin(node, makeContext(node))).toEqual([])
  })
})
