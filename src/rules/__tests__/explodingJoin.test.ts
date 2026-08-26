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
})
