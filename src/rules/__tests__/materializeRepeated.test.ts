import { describe, expect, it } from "vitest"
import { materializeRepeated } from "../materializeRepeated"
import { makeContext, makeNode } from "./testHelpers"

describe("materializeRepeated", () => {
  it("fires when loops, row volume, AND runtime contribution are all meaningful together", () => {
    const node = makeNode({ operatorType: "materialize", loops: 5_000, actualRows: 10_000, actualTimeMs: 0.5 })
    const warnings = materializeRepeated(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("materialize-repeated")
  })

  it("explains that Materialize itself is not inherently bad", () => {
    const node = makeNode({ operatorType: "materialize", loops: 5_000, actualRows: 10_000, actualTimeMs: 0.5 })
    const [warning] = materializeRepeated(node, makeContext(node))
    expect(warning.longText).toMatch(/not inherently bad/i)
  })

  it("does not fire with few loops, even with a large cached result and real time", () => {
    const node = makeNode({ operatorType: "materialize", loops: 2, actualRows: 100_000, actualTimeMs: 100 })
    expect(materializeRepeated(node, makeContext(node))).toEqual([])
  })

  it("does not fire with a small cached result, even with many loops", () => {
    const node = makeNode({ operatorType: "materialize", loops: 5_000, actualRows: 5, actualTimeMs: 100 })
    expect(materializeRepeated(node, makeContext(node))).toEqual([])
  })

  it("does not fire when the total runtime contribution is negligible", () => {
    const node = makeNode({ operatorType: "materialize", loops: 5_000, actualRows: 10_000, actualTimeMs: 0.001 })
    expect(materializeRepeated(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-Materialize operator", () => {
    const node = makeNode({ operatorType: "hash", loops: 5_000, actualRows: 10_000, actualTimeMs: 0.5 })
    expect(materializeRepeated(node, makeContext(node))).toEqual([])
  })
})
