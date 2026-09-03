import { describe, expect, it } from "vitest"
import { jitOverhead } from "../jitOverhead"
import { makeContext, makeNode } from "./testHelpers"

describe("jitOverhead", () => {
  it("fires for the story's own example (execution 40ms, JIT 28ms — 70%)", () => {
    const root = makeNode({ executionTimeMs: 40, jit: { totalMs: 28 } })
    const warnings = jitOverhead(root, makeContext(root))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("jit-overhead")
  })

  it("never states JIT should always be disabled", () => {
    const root = makeNode({ executionTimeMs: 40, jit: { totalMs: 28 } })
    const [warning] = jitOverhead(root, makeContext(root))
    expect(warning.longText).not.toMatch(/always disable/i)
    expect(warning.longText).not.toMatch(/should be disabled/i)
  })

  it("does not fire below the JIT-time materiality floor", () => {
    const root = makeNode({ executionTimeMs: 5, jit: { totalMs: 4 } })
    expect(jitOverhead(root, makeContext(root))).toEqual([])
  })

  it("does not fire when JIT is a small share of execution", () => {
    const root = makeNode({ executionTimeMs: 1000, jit: { totalMs: 20 } })
    expect(jitOverhead(root, makeContext(root))).toEqual([])
  })

  it("only evaluates the root node", () => {
    const child = makeNode({ id: "child", executionTimeMs: 40, jit: { totalMs: 28 } })
    const root = makeNode({ id: "root", children: [child] })
    expect(jitOverhead(child, makeContext(root))).toEqual([])
  })

  it("does not fire and does not throw when jit info is absent", () => {
    const root = makeNode({ executionTimeMs: 40 })
    expect(() => jitOverhead(root, makeContext(root))).not.toThrow()
    expect(jitOverhead(root, makeContext(root))).toEqual([])
  })
})
