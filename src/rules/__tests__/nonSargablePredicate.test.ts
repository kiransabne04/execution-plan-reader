import { describe, expect, it } from "vitest"
import { nonSargablePredicate } from "../nonSargablePredicate"
import { makeContext, makeNode } from "./testHelpers"

describe("nonSargablePredicate", () => {
  it("fires on a filter that wraps a column in a function before a comparison", () => {
    const node = makeNode({
      operatorType: "seq_scan",
      predicate: { filter: "(lower(name) = 'acme corp'::text)" },
    })
    const warnings = nonSargablePredicate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("non-sargable-predicate")
    expect(warnings[0].severity).toBe("info")
    expect(warnings[0].shortText).toContain("lower(name)")
  })

  it("fires on a leading-wildcard LIKE — Postgres's own `~~` rendering and the literal keyword both — but not on a trailing-wildcard one (still sargable)", () => {
    // Postgres's EXPLAIN output renders LIKE as the `~~` operator, never
    // the word "LIKE" itself.
    const postgresLeading = makeNode({ predicate: { filter: "(email ~~ '%@example.com'::text)" } })
    expect(nonSargablePredicate(postgresLeading, makeContext(postgresLeading))).toHaveLength(1)

    const leadingLike = makeNode({ engine: "sqlserver", predicate: { filter: "[email] like '%@example.com'" } })
    expect(nonSargablePredicate(leadingLike, makeContext(leadingLike))).toHaveLength(1)

    const trailing = makeNode({ predicate: { filter: "(email ~~ 'acme%'::text)" } })
    expect(nonSargablePredicate(trailing, makeContext(trailing))).toHaveLength(0)
  })

  it("fires on a join condition wrapping a column in a function on either side", () => {
    const node = makeNode({
      operatorType: "hash_join",
      predicate: { joinCondition: "(lower(a.email) = lower(b.email))" },
    })
    const warnings = nonSargablePredicate(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("join condition")
  })

  it("does NOT fire when the function wraps a literal, not a column — that's still sargable", () => {
    const node = makeNode({ predicate: { filter: "(name = lower('Acme Corp'::text))" } })
    expect(nonSargablePredicate(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a plain, directly-comparable filter", () => {
    const node = makeNode({ predicate: { filter: "(status = 'active'::text)" } })
    expect(nonSargablePredicate(node, makeContext(node))).toEqual([])
  })

  it("never flags an indexCondition — a condition that made it into an index seek demonstrably already used one", () => {
    const node = makeNode({
      operatorType: "index_scan",
      predicate: { indexCondition: "(lower(name) = 'acme corp'::text)" },
    })
    expect(nonSargablePredicate(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw on a node with no predicate at all", () => {
    const node = makeNode({})
    expect(() => nonSargablePredicate(node, makeContext(node))).not.toThrow()
    expect(nonSargablePredicate(node, makeContext(node))).toEqual([])
  })

  it("fires the same way for SQL Server and Snowflake nodes — the check is engine-agnostic text matching", () => {
    const sqlserver = makeNode({ engine: "sqlserver", predicate: { filter: "UPPER([name])='ACME'" } })
    expect(nonSargablePredicate(sqlserver, makeContext(sqlserver))).toHaveLength(1)

    const snowflake = makeNode({ engine: "snowflake", predicate: { filter: "date(created_at) > '2024-01-01'" } })
    expect(nonSargablePredicate(snowflake, makeContext(snowflake))).toHaveLength(1)
  })
})
