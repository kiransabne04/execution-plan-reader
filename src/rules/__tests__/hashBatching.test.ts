import { describe, expect, it } from "vitest"
import { hashBatching } from "../hashBatching"
import { makeContext, makeNode } from "./testHelpers"

describe("hashBatching", () => {
  it("fires for the story's own example (Batches > 1, substantial data)", () => {
    const node = makeNode({ operatorType: "hash", actualRows: 8_000, hash: { batches: 4, originalBatches: 1, buckets: 16384, peakMemoryKb: 4096 } })
    const warnings = hashBatching(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("hash-batching")
    expect(warnings[0].longText).toMatch(/did not fit into the memory available.*multiple batches/i)
  })

  it("escalates to critical for a very high batch count", () => {
    const node = makeNode({ operatorType: "hash", actualRows: 8_000, hash: { batches: 16 } })
    expect(hashBatching(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("does not fire when batches === 1 (no batching occurred)", () => {
    const node = makeNode({ operatorType: "hash", actualRows: 8_000, hash: { batches: 1 } })
    expect(hashBatching(node, makeContext(node))).toEqual([])
  })

  it("does not fire below the row-volume floor even with real batching", () => {
    const node = makeNode({ operatorType: "hash", actualRows: 10, hash: { batches: 4 } })
    expect(hashBatching(node, makeContext(node))).toEqual([])
  })

  it("does not fire on a non-Hash operator", () => {
    const node = makeNode({ operatorType: "seq_scan", actualRows: 8_000, hash: { batches: 4 } })
    expect(hashBatching(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when hash info is absent", () => {
    const node = makeNode({ operatorType: "hash", actualRows: 8_000 })
    expect(() => hashBatching(node, makeContext(node))).not.toThrow()
    expect(hashBatching(node, makeContext(node))).toEqual([])
  })
})
