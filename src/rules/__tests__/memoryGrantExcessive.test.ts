import { describe, expect, it } from "vitest"
import { memoryGrantExcessive } from "../memoryGrantExcessive"
import { makeContext, makeNode } from "./testHelpers"

function makeRootWithGrant(grantedKb: number, maxUsedKb: number) {
  return makeNode({ engine: "sqlserver", memoryGrant: { grantedKb, maxUsedKb } })
}

describe("memoryGrantExcessive", () => {
  it("fires on the story's own example: granted 1GB, max used 70MB", () => {
    const node = makeRootWithGrant(1_048_576, 71_680) // 1GB / 70MB in KB
    const context = makeContext(node)
    const warnings = memoryGrantExcessive(node, context)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("memory-grant-excessive")
    expect(warnings[0].shortText).toContain("1 GB")
    expect(warnings[0].shortText).toContain("70 MB")
  })

  it("does NOT fire when granted and used are close", () => {
    const node = makeRootWithGrant(100_000, 90_000)
    expect(memoryGrantExcessive(node, makeContext(node))).toEqual([])
  })

  it("ratio floor alone excludes a case with a large absolute waste but low ratio", () => {
    // 200,000 KB granted, 100,000 KB used — 2x ratio (below the 4x floor)
    // despite 100,000 KB (~100MB) of real absolute waste.
    const node = makeRootWithGrant(200_000, 100_000)
    expect(memoryGrantExcessive(node, makeContext(node))).toEqual([])
  })

  it("absolute floor alone excludes a high ratio on a trivial amount of memory", () => {
    // 2,048 KB granted, 200 KB used — >10x ratio, but only ~1.8MB wasted,
    // well below the 50MB materiality floor.
    const node = makeRootWithGrant(2_048, 200)
    expect(memoryGrantExcessive(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-SQL-Server engine", () => {
    const node = makeNode({ engine: "postgres", memoryGrant: { grantedKb: 1_048_576, maxUsedKb: 71_680 } })
    expect(memoryGrantExcessive(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire on a non-root node even if it somehow carried a memoryGrant", () => {
    const child = makeRootWithGrant(1_048_576, 71_680)
    const root = makeNode({ engine: "sqlserver", children: [child] })
    expect(memoryGrantExcessive(child, makeContext(root))).toEqual([])
  })

  it("does NOT fire when memoryGrant is entirely absent (no MemoryGrantInfo in the plan)", () => {
    const node = makeNode({ engine: "sqlserver" })
    expect(() => memoryGrantExcessive(node, makeContext(node))).not.toThrow()
    expect(memoryGrantExcessive(node, makeContext(node))).toEqual([])
  })

  it("escalates to critical above the large-ratio threshold, warning below it", () => {
    // 4x ratio — clears the 4x floor but stays below the 10x critical floor.
    const warningCase = makeRootWithGrant(400_000, 100_000)
    expect(memoryGrantExcessive(warningCase, makeContext(warningCase))[0].severity).toBe("warning")

    const criticalCase = makeRootWithGrant(1_048_576, 71_680) // ~14.6x
    expect(memoryGrantExcessive(criticalCase, makeContext(criticalCase))[0].severity).toBe("critical")
  })

  it("handles maxUsedKb === 0 without dividing by zero into NaN/Infinity in the displayed text", () => {
    const node = makeRootWithGrant(1_048_576, 0)
    const warnings = memoryGrantExcessive(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).not.toMatch(/NaN|Infinity/)
    expect(warnings[0].longText).not.toMatch(/NaN|Infinity/)
  })

  it("explains the concurrency impact, not just this query's own performance", () => {
    const node = makeRootWithGrant(1_048_576, 71_680)
    const longText = memoryGrantExcessive(node, makeContext(node))[0].longText
    expect(longText.toLowerCase()).toContain("concurrency")
    expect(longText).toContain("unavailable to every other query")
  })

  it("does not throw on pathological numeric input", () => {
    for (const grantedKb of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      const node = makeRootWithGrant(grantedKb, 100)
      expect(() => memoryGrantExcessive(node, makeContext(node))).not.toThrow()
    }
  })
})
