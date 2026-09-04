import { describe, expect, it } from "vitest"
import { pgNestedLoopExplosion } from "../pgNestedLoopExplosion"
import { makeContext, makeNode } from "./testHelpers"

function makeJoin(outerActualRows: number, innerLoops: number, innerPerLoopMs: number) {
  const outer = makeNode({ operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", actualRows: outerActualRows })
  const inner = makeNode({ operatorType: "index_scan", rawOperatorLabel: "Index Scan", loops: innerLoops, actualTimeMs: innerPerLoopMs })
  return makeNode({ operatorType: "nested_loop_join", rawOperatorLabel: "Nested Loop", children: [outer, inner] })
}

describe("pgNestedLoopExplosion", () => {
  it("fires on the story's own explosion example: outer 480k, loops 480k, substantial cumulative time", () => {
    const node = makeJoin(480_000, 480_000, 0.5) // 240,000ms cumulative
    const warnings = pgNestedLoopExplosion(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("nested-loop-explosion")
    expect(warnings[0].severity).toBe("critical")
    expect(warnings[0].shortText).toContain("480,000")
  })

  it("does NOT fire on the story's own healthy example: outer 5, loops 5, 0.4ms total", () => {
    const node = makeJoin(5, 5, 0.08) // 5 * 0.08 = 0.4ms cumulative
    expect(pgNestedLoopExplosion(node, makeContext(node))).toEqual([])
  })

  it("cumulative-time floor alone excludes the healthy case, independent of the row-count floor", () => {
    // Deliberately push outer/loops far above their own floors, but keep
    // cumulative inner time tiny — the cumulative floor must be the thing
    // that stops this on its own.
    const node = makeJoin(50_000, 50_000, 0.001) // 50ms cumulative — below the 1000ms floor
    expect(pgNestedLoopExplosion(node, makeContext(node))).toEqual([])
  })

  it("row-count floors exclude a case with big cumulative time but small outer/loops", () => {
    // 500 loops at 5ms each = 2500ms cumulative (clears the time floor) but
    // loops is below INNER_LOOPS_THRESHOLD (10,000).
    const node = makeJoin(500, 500, 5)
    expect(pgNestedLoopExplosion(node, makeContext(node))).toEqual([])
  })

  it("only fires on Postgres nested_loop_join, never other engines/operators", () => {
    const sqlServerNode = makeNode({
      engine: "sqlserver",
      operatorType: "nested_loop_join",
      children: [makeNode({ actualRows: 480_000 }), makeNode({ loops: 480_000, actualTimeMs: 5 })],
    })
    expect(pgNestedLoopExplosion(sqlServerNode, makeContext(sqlServerNode))).toEqual([])

    const notAJoin = makeJoin(480_000, 480_000, 5)
    notAJoin.operatorType = "hash_join"
    expect(pgNestedLoopExplosion(notAJoin, makeContext(notAJoin))).toEqual([])
  })

  it("does not fire and does not throw with fewer than 2 children", () => {
    const node = makeNode({ engine: "postgres", operatorType: "nested_loop_join", children: [makeNode({ actualRows: 480_000 })] })
    expect(() => pgNestedLoopExplosion(node, makeContext(node))).not.toThrow()
    expect(pgNestedLoopExplosion(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when required fields are missing", () => {
    const node = makeNode({
      engine: "postgres",
      operatorType: "nested_loop_join",
      children: [makeNode({}), makeNode({})],
    })
    expect(() => pgNestedLoopExplosion(node, makeContext(node))).not.toThrow()
    expect(pgNestedLoopExplosion(node, makeContext(node))).toEqual([])
  })

  it("escalates to critical above the large-cumulative-time threshold, warning below it", () => {
    const warningCase = makeJoin(20_000, 20_000, 0.1) // 2000ms — above 1000ms, below 10,000ms
    expect(pgNestedLoopExplosion(warningCase, makeContext(warningCase))[0].severity).toBe("warning")

    const criticalCase = makeJoin(20_000, 20_000, 1) // 20,000ms — above the 10,000ms large threshold
    expect(pgNestedLoopExplosion(criticalCase, makeContext(criticalCase))[0].severity).toBe("critical")
  })

  // Story 25.3 — repeated inner scan differentiation, folded into this
  // same rule's longText.
  it("frames a cheap-per-loop, high-frequency pattern as 'reduce the outer row count'", () => {
    const node = makeJoin(50_000, 50_000, 0.05) // cheap per-loop (< 0.5ms threshold)
    const longText = pgNestedLoopExplosion(node, makeContext(node))[0].longText
    expect(longText).toContain("individually cheap")
    expect(longText).toContain("Reducing the outer row count")
  })

  it("frames an expensive-per-loop pattern as 'make the inner side cheaper'", () => {
    const node = makeJoin(50_000, 50_000, 2) // expensive per-loop (>= 0.5ms threshold)
    const longText = pgNestedLoopExplosion(node, makeContext(node))[0].longText
    expect(longText).toContain("genuinely expensive child")
    expect(longText).toContain("Making the inner side itself cheaper")
  })

  it("labels the total repeated-work figure as approximate, never a measured total", () => {
    const node = makeJoin(50_000, 50_000, 1)
    const longText = pgNestedLoopExplosion(node, makeContext(node))[0].longText
    expect(longText).toContain("approximate total repeated inner-side cost")
    expect(longText).toContain("approximate because")
  })
})
