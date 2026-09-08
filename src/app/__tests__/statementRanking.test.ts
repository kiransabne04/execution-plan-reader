import { describe, expect, it } from "vitest"
import { computeTotalReads, rankStatements } from "../statementRanking"
import { applyRules } from "../../rules/index"
import { buildPlanContext } from "../../rules/types"
import { makeNode } from "../../rules/__tests__/testHelpers"
import type { PlanNode } from "../../parsers/normalize"

/** `rankStatements` reads findings via `node.warnings`, which only real
 * `applyRules` populates — `makeNode` alone starts every node at `[]`. */
function analyzed(root: PlanNode): PlanNode {
  applyRules(root, buildPlanContext(root))
  return root
}

describe("computeTotalReads", () => {
  it("sums bufferHits + bufferReads across the whole tree", () => {
    const child = makeNode({ io: { bufferHits: 100, bufferReads: 50 } })
    const root = makeNode({ io: { bufferHits: 10, bufferReads: 5 }, children: [child] })
    expect(computeTotalReads(root)).toBe(165)
  })

  it("returns undefined when no node anywhere has io data", () => {
    const root = makeNode({ children: [makeNode({})] })
    expect(computeTotalReads(root)).toBeUndefined()
  })

  it("does not return 0 for a tree with some io data present but genuinely zero reads", () => {
    const root = makeNode({ io: { bufferHits: 0, bufferReads: 0 } })
    expect(computeTotalReads(root)).toBe(0)
  })
})

describe("rankStatements", () => {
  it("ranks statements with real duration above compiled-only-cost statements", () => {
    const withDuration = makeNode({ actualTimeMs: 500, actualRows: 10 })
    const costOnly = makeNode({ estimatedCost: 999_999 }) // huge cost, but no actual data
    const ranked = rankStatements([
      { root: costOnly, label: "cost-only" },
      { root: withDuration, label: "with-duration" },
    ])
    expect(ranked[0].label).toBe("with-duration")
    expect(ranked[1].label).toBe("cost-only")
  })

  it("sorts by duration descending among statements that both have real duration", () => {
    const slow = makeNode({ actualTimeMs: 5_000, actualRows: 10 })
    const fast = makeNode({ actualTimeMs: 50, actualRows: 10 })
    const ranked = rankStatements([
      { root: fast, label: "fast" },
      { root: slow, label: "slow" },
    ])
    expect(ranked.map((r) => r.label)).toEqual(["slow", "fast"])
  })

  it("falls back to estimated cost when NO statement in the batch has real duration", () => {
    const cheap = makeNode({ estimatedCost: 10 })
    const expensive = makeNode({ estimatedCost: 500 })
    const ranked = rankStatements([
      { root: cheap, label: "cheap" },
      { root: expensive, label: "expensive" },
    ])
    expect(ranked.map((r) => r.label)).toEqual(["expensive", "cheap"])
  })

  it("excludes trivial statements (no findings, no duration/cost) from the ranking entirely", () => {
    const real = makeNode({ actualTimeMs: 500, actualRows: 10 })
    const trivial = makeNode({}) // no duration, no cost, no findings — isTrivialStatement === true
    const ranked = rankStatements([
      { root: trivial, label: "trivial" },
      { root: real, label: "real" },
    ])
    expect(ranked).toHaveLength(1)
    expect(ranked[0].label).toBe("real")
  })

  it("breaks a duration tie using critical-finding count", () => {
    const noCritical = makeNode({ actualTimeMs: 500, actualRows: 10 })
    // A Cartesian join is explodingJoin.ts's own critical-severity case.
    const withCritical = analyzed(
      makeNode({
        actualTimeMs: 500,
        operatorType: "cartesian_join",
        actualRows: 1_000,
        children: [makeNode({ actualRows: 5 }), makeNode({ actualRows: 5 })],
      }),
    )
    const ranked = rankStatements([
      { root: noCritical, label: "no-critical" },
      { root: withCritical, label: "with-critical" },
    ])
    expect(ranked[0].label).toBe("with-critical")
    expect(ranked[0].criticalFindingCount).toBeGreaterThan(0)
  })

  it("breaks a remaining tie using total reads", () => {
    const fewerReads = makeNode({ actualTimeMs: 500, actualRows: 10, io: { bufferHits: 10, bufferReads: 0 } })
    const moreReads = makeNode({ actualTimeMs: 500, actualRows: 10, io: { bufferHits: 10_000, bufferReads: 0 } })
    const ranked = rankStatements([
      { root: fewerReads, label: "fewer-reads" },
      { root: moreReads, label: "more-reads" },
    ])
    expect(ranked[0].label).toBe("more-reads")
  })

  it("assigns a 1-based rank matching the sorted order", () => {
    const slow = makeNode({ actualTimeMs: 5_000, actualRows: 10 })
    const fast = makeNode({ actualTimeMs: 50, actualRows: 10 })
    const ranked = rankStatements([
      { root: fast, label: "fast" },
      { root: slow, label: "slow" },
    ])
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].rank).toBe(2)
  })

  it("preserves the original batch index for jumping back to a statement", () => {
    const a = makeNode({ actualTimeMs: 50, actualRows: 10 })
    const b = makeNode({ actualTimeMs: 5_000, actualRows: 10 })
    const ranked = rankStatements([
      { root: a, label: "a" },
      { root: b, label: "b" },
    ])
    expect(ranked[0].index).toBe(1) // b was originally index 1, ranks first
    expect(ranked[1].index).toBe(0)
  })

  it("never compares a duration value directly against a cost value", () => {
    // A tiny duration must always outrank a huge cost figure — different
    // units, never blended into one number.
    const tinyDuration = makeNode({ actualTimeMs: 1, actualRows: 10 })
    const hugeCost = makeNode({ estimatedCost: 10_000_000 })
    const ranked = rankStatements([
      { root: hugeCost, label: "huge-cost" },
      { root: tinyDuration, label: "tiny-duration" },
    ])
    expect(ranked[0].label).toBe("tiny-duration")
  })
})
