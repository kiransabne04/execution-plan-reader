import { describe, expect, it } from "vitest"
import { memoizeEffectiveness } from "../memoizeEffectiveness"
import { makeContext, makeNode } from "./testHelpers"

describe("memoizeEffectiveness", () => {
  it("fires memoize-low-hit-rate for a genuinely poor hit rate at real volume", () => {
    const node = makeNode({ operatorType: "memoize", memoize: { cacheHits: 100, cacheMisses: 900 } })
    const warnings = memoizeEffectiveness(node, makeContext(node))
    expect(warnings.some((w) => w.ruleId === "memoize-low-hit-rate")).toBe(true)
  })

  it("fires memoize-evictions when evictions are a meaningful share of lookups", () => {
    const node = makeNode({ operatorType: "memoize", memoize: { cacheHits: 900, cacheMisses: 100, cacheEvictions: 200 } })
    const warnings = memoizeEffectiveness(node, makeContext(node))
    expect(warnings.some((w) => w.ruleId === "memoize-evictions")).toBe(true)
  })

  it("can fire BOTH findings together when both conditions hold", () => {
    const node = makeNode({ operatorType: "memoize", memoize: { cacheHits: 100, cacheMisses: 900, cacheEvictions: 300 } })
    const warnings = memoizeEffectiveness(node, makeContext(node))
    expect(warnings).toHaveLength(2)
  })

  it("does not warn simply because Memoize exists — a healthy, high hit-rate cache fires nothing", () => {
    const node = makeNode({ operatorType: "memoize", memoize: { cacheHits: 950, cacheMisses: 50, cacheEvictions: 0 } })
    expect(memoizeEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the total-lookups volume floor, even at a 0% hit rate", () => {
    const node = makeNode({ operatorType: "memoize", memoize: { cacheHits: 0, cacheMisses: 5 } })
    expect(memoizeEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-Memoize operator", () => {
    const node = makeNode({ operatorType: "hash", memoize: { cacheHits: 100, cacheMisses: 900 } })
    expect(memoizeEffectiveness(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when memoize info is absent", () => {
    const node = makeNode({ operatorType: "memoize" })
    expect(() => memoizeEffectiveness(node, makeContext(node))).not.toThrow()
    expect(memoizeEffectiveness(node, makeContext(node))).toEqual([])
  })
})
