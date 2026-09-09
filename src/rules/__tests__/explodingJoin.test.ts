import { describe, expect, it } from "vitest"
import { explodingJoin } from "../explodingJoin"
import { makeContext, makeNode } from "./testHelpers"

describe("explodingJoin", () => {
  it("fires when output rows vastly exceed the largest input", () => {
    const left = makeNode({ actualRows: 100 })
    const right = makeNode({ actualRows: 50 })
    const join = makeNode({ operatorType: "hash_join", actualRows: 5000, children: [left, right] })
    const warnings = explodingJoin(join, makeContext(join))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("exploding-join")
    expect(warnings[0].severity).toBe("warning")
  })

  it("marks a CartesianJoin explosion as critical", () => {
    const left = makeNode({ actualRows: 100 })
    const right = makeNode({ actualRows: 50 })
    const join = makeNode({ operatorType: "cartesian_join", actualRows: 5000, children: [left, right] })
    expect(explodingJoin(join, makeContext(join))[0].severity).toBe("critical")
  })

  it("does NOT fire on a normal one-to-many join", () => {
    const left = makeNode({ actualRows: 5000 })
    const right = makeNode({ actualRows: 800 })
    const join = makeNode({ operatorType: "hash_join", actualRows: 4800, children: [left, right] })
    expect(explodingJoin(join, makeContext(join))).toEqual([])
  })

  it("does not fire on a non-join operator", () => {
    const node = makeNode({ operatorType: "seq_scan", actualRows: 100_000, children: [] })
    expect(explodingJoin(node, makeContext(node))).toEqual([])
  })

  it("does not throw when child row counts are missing", () => {
    const join = makeNode({ operatorType: "hash_join", actualRows: 5000, children: [makeNode({})] })
    expect(() => explodingJoin(join, makeContext(join))).not.toThrow()
    expect(explodingJoin(join, makeContext(join))).toEqual([])
  })

  // Episode 32, Story 32.1.
  describe("Snowflake — never labels a generic Join as a hash join", () => {
    it("uses input/output cardinality vocabulary and discloses no physical algorithm is known", () => {
      const left = makeNode({ engine: "snowflake", actualRows: 100 })
      const right = makeNode({ engine: "snowflake", actualRows: 50 })
      const join = makeNode({ engine: "snowflake", operatorType: "join", rawOperatorLabel: "Join", actualRows: 5000, children: [left, right] })
      const longText = explodingJoin(join, makeContext(join))[0].longText
      expect(longText).toContain("output cardinality")
      expect(longText).toContain("input cardinality")
      expect(longText).toContain("doesn't reveal which physical join algorithm")
      // Allowed to NAME "hash join" only as part of explicitly ruling it
      // out — never as an affirmative claim that this operator IS one.
      expect(longText).toContain("not specifically a hash join")
      expect(longText).not.toMatch(/\bis (a |specifically a )?hash join\b/i)
    })

    it("does not add the algorithm disclosure for a Snowflake CartesianJoin — its own name is already explicit", () => {
      const left = makeNode({ engine: "snowflake", actualRows: 100 })
      const right = makeNode({ engine: "snowflake", actualRows: 50 })
      const join = makeNode({ engine: "snowflake", operatorType: "cartesian_join", rawOperatorLabel: "CartesianJoin", actualRows: 5000, children: [left, right] })
      const longText = explodingJoin(join, makeContext(join))[0].longText
      expect(longText).not.toContain("doesn't reveal which physical join algorithm")
    })

    it("does not add the Snowflake disclosure for a Postgres/SQL Server join", () => {
      const left = makeNode({ actualRows: 100 })
      const right = makeNode({ actualRows: 50 })
      const join = makeNode({ operatorType: "hash_join", actualRows: 5000, children: [left, right] })
      const longText = explodingJoin(join, makeContext(join))[0].longText
      expect(longText).not.toContain("Snowflake")
    })
  })

  // Addendum — prefer Snowflake's real input_rows over the max-of-children derivation.
  describe("Snowflake — prefers native input_rows over the derived max-of-children", () => {
    it("uses inputRows for the ratio math instead of the larger max-of-children value", () => {
      const left = makeNode({ engine: "snowflake", actualRows: 100 })
      const right = makeNode({ engine: "snowflake", actualRows: 50 })
      // Native inputRows (10) is smaller than max(children) (100) — if the
      // rule wrongly preferred the derived value, the ratio/text would
      // reflect 100, not 10.
      const join = makeNode({ engine: "snowflake", operatorType: "join", actualRows: 5000, inputRows: 10, children: [left, right] })
      const warnings = explodingJoin(join, makeContext(join))
      expect(warnings[0].longText).toContain("10 rows")
      expect(warnings[0].longText).not.toContain("100 rows")
    })

    it("phrases the native case as a single total, not 'at most'", () => {
      const child = makeNode({ engine: "snowflake", actualRows: 100 })
      const join = makeNode({ engine: "snowflake", operatorType: "join", actualRows: 5000, inputRows: 10, children: [child] })
      const longText = explodingJoin(join, makeContext(join))[0].longText
      expect(longText).not.toContain("at most")
    })

    it("still falls back to max-of-children when inputRows is absent", () => {
      const left = makeNode({ engine: "snowflake", actualRows: 100 })
      const right = makeNode({ engine: "snowflake", actualRows: 50 })
      const join = makeNode({ engine: "snowflake", operatorType: "join", actualRows: 5000, children: [left, right] })
      const longText = explodingJoin(join, makeContext(join))[0].longText
      expect(longText).toContain("at most 100 rows")
    })
  })
})
