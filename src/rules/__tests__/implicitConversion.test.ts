import { describe, expect, it } from "vitest"
import { findConvertImplicitConversions, implicitConversion } from "../implicitConversion"
import { makeContext, makeNode } from "./testHelpers"

describe("findConvertImplicitConversions", () => {
  it("extracts target type and expression from a simple conversion", () => {
    const matches = findConvertImplicitConversions("CONVERT_IMPLICIT(int,[MyDb].[dbo].[Orders].[CustomerCode],0)")
    expect(matches).toEqual([{ targetType: "int", expression: "[MyDb].[dbo].[Orders].[CustomerCode]" }])
  })

  it("handles a parameterized target type (e.g. varchar(50))", () => {
    const matches = findConvertImplicitConversions("[MyDb].[dbo].[Orders].[OrderCode]=CONVERT_IMPLICIT(varchar(50),[@P1],0)")
    expect(matches).toEqual([{ targetType: "varchar(50)", expression: "[@P1]" }])
  })

  it("finds multiple distinct conversions in one string", () => {
    const text = "CONVERT_IMPLICIT(int,[a],0)=1 AND CONVERT_IMPLICIT(varchar(10),[b],0)='x'"
    const matches = findConvertImplicitConversions(text)
    expect(matches).toEqual([
      { targetType: "int", expression: "[a]" },
      { targetType: "varchar(10)", expression: "[b]" },
    ])
  })

  it("returns an empty array for text with no CONVERT_IMPLICIT at all", () => {
    expect(findConvertImplicitConversions("[MyDb].[dbo].[Orders].[CustomerId]=(42)")).toEqual([])
  })
})

describe("implicitConversion", () => {
  it("does NOT fire on a plain node with no predicate/join-key text at all", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "index_seek" })
    expect(implicitConversion(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when predicate text has no CONVERT_IMPLICIT", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "index_seek",
      predicate: { indexCondition: "[MyDb].[dbo].[Orders].[CustomerId]=(42)" },
    })
    expect(implicitConversion(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine even with matching text", () => {
    const node = makeNode({
      engine: "postgres",
      operatorType: "index_scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[Customers].[StatusCode],0)='active'" },
    })
    expect(implicitConversion(node, makeContext(node))).toEqual([])
  })

  it("fires at info severity when found only in a seek predicate", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "index_seek",
      rawOperatorLabel: "Index Seek",
      predicate: { indexCondition: "[Orders].[OrderCode]=CONVERT_IMPLICIT(varchar(50),[@P1],0)" },
    })
    const warnings = implicitConversion(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("implicit-conversion")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].shortText).toContain("seek predicate")
  })

  it("fires at warning severity when found in a residual predicate", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "table_scan",
      rawOperatorLabel: "Table Scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[Customers].[StatusCode],0)='active'" },
    })
    const warnings = implicitConversion(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe("warning")
    expect(warnings[0].shortText).toContain("residual predicate")
  })

  it("fires at warning severity when found only in a join key", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "hash_join",
      rawOperatorLabel: "Hash Match",
      attributes: { "Join Key Implicit Conversion": "CONVERT_IMPLICIT(int,[Orders].[CustomerCode],0)" },
    })
    const warnings = implicitConversion(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].severity).toBe("warning")
    expect(warnings[0].shortText).toContain("join key")
  })

  it("escalates to warning when found in BOTH a seek predicate and a residual predicate on the same node", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "index_seek",
      predicate: {
        indexCondition: "[Orders].[OrderCode]=CONVERT_IMPLICIT(varchar(50),[@P1],0)",
        filter: "CONVERT_IMPLICIT(varchar(20),[Orders].[StatusCode],0)='active'",
      },
    })
    expect(implicitConversion(node, makeContext(node))[0].severity).toBe("warning")
  })

  it("never claims a specific source type — only target type and the converted expression", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "table_scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[Customers].[StatusCode],0)='active'" },
    })
    const longText = implicitConversion(node, makeContext(node))[0].longText
    expect(longText).toContain("doesn't show the column's own original declared type")
    expect(longText).not.toMatch(/source type/i)
  })

  it("never states that every implicit conversion prevents an index seek", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "table_scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[Customers].[StatusCode],0)='active'" },
    })
    const longText = implicitConversion(node, makeContext(node))[0].longText
    expect(longText).toContain("Not every implicit conversion prevents an index seek")
  })

  it("explains index-access degradation, estimate issues, and CPU overhead for the residual/join-key case", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "table_scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[Customers].[StatusCode],0)='active'" },
    })
    const longText = implicitConversion(node, makeContext(node))[0].longText
    expect(longText).toContain("index access degradation")
    expect(longText).toContain("cardinality-estimate error")
    expect(longText).toContain("CPU overhead")
  })

  it("exposes the converted expression and target type in shortText and longText", () => {
    const node = makeNode({
      engine: "sqlserver",
      operatorType: "table_scan",
      predicate: { filter: "CONVERT_IMPLICIT(varchar(20),[MyDb].[dbo].[Customers].[StatusCode],0)='active'" },
    })
    const warnings = implicitConversion(node, makeContext(node))
    expect(warnings[0].shortText).toContain("[MyDb].[dbo].[Customers].[StatusCode] → varchar(20)")
    expect(warnings[0].longText).toContain("[MyDb].[dbo].[Customers].[StatusCode] → varchar(20)")
  })

  it("does not throw on a malformed CONVERT_IMPLICIT-looking string", () => {
    const node = makeNode({ engine: "sqlserver", operatorType: "table_scan", predicate: { filter: "CONVERT_IMPLICIT(garbage" } })
    expect(() => implicitConversion(node, makeContext(node))).not.toThrow()
    expect(implicitConversion(node, makeContext(node))).toEqual([])
  })
})
