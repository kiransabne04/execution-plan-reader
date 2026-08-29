import { describe, expect, it } from "vitest"
import { buildComparisonSummary } from "../summary"
import { makeNode } from "./testHelpers"
import type { NodeMatch } from "../matchNodes"

describe("buildComparisonSummary", () => {
  it("states counts and a cost delta in the story's own example shape", () => {
    const matches: NodeMatch[] = [
      { status: "changed", nodeIdA: "a1", nodeIdB: "b1" },
      { status: "changed", nodeIdA: "a2", nodeIdB: "b2" },
      { status: "changed", nodeIdA: "a3", nodeIdB: "b3" },
      { status: "addedInB", nodeIdB: "b4" },
      { status: "matched", nodeIdA: "a5", nodeIdB: "b5" },
    ]
    const planA = makeNode({ estimatedCost: 100 })
    const planB = makeNode({ estimatedCost: 60 })

    const summary = buildComparisonSummary(matches, planA, planB)
    expect(summary.headline).toBe("3 nodes changed, 1 added, 0 removed — total estimated cost decreased by 40%.")
    expect(summary.lowConfidenceWarning).toBeUndefined()
  })

  it("uses singular 'node' for exactly one changed node", () => {
    const summary = buildComparisonSummary([{ status: "changed", nodeIdA: "a1", nodeIdB: "b1" }], makeNode(), makeNode())
    expect(summary.headline).toMatch(/^1 node changed,/)
  })

  it("reports an increase when cost went up", () => {
    const planA = makeNode({ estimatedCost: 50 })
    const planB = makeNode({ estimatedCost: 75 })
    const summary = buildComparisonSummary([], planA, planB)
    expect(summary.headline).toContain("total estimated cost increased by 50%")
  })

  it("omits the cost clause entirely when either plan lacks estimatedCost — a genuine cross-engine gap, never a fabricated number", () => {
    const planA = makeNode({ estimatedCost: 100 })
    const planB = makeNode({ estimatedCost: undefined }) // e.g. Snowflake, which has no comparable cost unit
    const summary = buildComparisonSummary([], planA, planB)
    expect(summary.headline).toBe("0 nodes changed, 0 added, 0 removed.")
  })

  it("flags low confidence and includes a caution note when the match ratio is low", () => {
    const matches: NodeMatch[] = [
      { status: "matched", nodeIdA: "a1", nodeIdB: "b1" },
      { status: "removedFromB", nodeIdA: "a2" },
      { status: "removedFromB", nodeIdA: "a3" },
      { status: "addedInB", nodeIdB: "b4" },
      { status: "addedInB", nodeIdB: "b5" },
    ]
    const summary = buildComparisonSummary(matches, makeNode(), makeNode())
    expect(summary.lowConfidenceWarning).toBeDefined()
    expect(summary.lowConfidenceWarning).toMatch(/may not be comparable/)
  })
})
