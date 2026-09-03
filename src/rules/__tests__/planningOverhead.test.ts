import { describe, expect, it } from "vitest"
import { planningOverhead } from "../planningOverhead"
import { makeContext, makeNode } from "./testHelpers"

describe("planningOverhead", () => {
  it("fires for the story's own example (planning 240ms, execution 8ms)", () => {
    const root = makeNode({ planningTimeMs: 240, executionTimeMs: 8 })
    const warnings = planningOverhead(root, makeContext(root))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("planning-overhead")
  })

  it("does NOT fire on the story's own trivial example (0.3ms planning / 0.05ms execution)", () => {
    const root = makeNode({ planningTimeMs: 0.3, executionTimeMs: 0.05 })
    expect(planningOverhead(root, makeContext(root))).toEqual([])
  })

  it("does not fire below the absolute planning-time floor even at a huge ratio", () => {
    const root = makeNode({ planningTimeMs: 10, executionTimeMs: 0.01 })
    expect(planningOverhead(root, makeContext(root))).toEqual([])
  })

  it("does not fire when planning is present but doesn't dominate execution", () => {
    const root = makeNode({ planningTimeMs: 60, executionTimeMs: 5000 })
    expect(planningOverhead(root, makeContext(root))).toEqual([])
  })

  it("only evaluates the root node, never a child", () => {
    const child = makeNode({ id: "child", planningTimeMs: 240, executionTimeMs: 8 })
    const root = makeNode({ id: "root", children: [child] })
    expect(planningOverhead(child, makeContext(root))).toEqual([])
  })

  it("does not fire and does not throw when executionTimeMs is absent", () => {
    const root = makeNode({ planningTimeMs: 240 })
    expect(() => planningOverhead(root, makeContext(root))).not.toThrow()
    expect(planningOverhead(root, makeContext(root))).toEqual([])
  })
})
