import { describe, expect, it } from "vitest"
import { walVolume } from "../walVolume"
import { makeContext, makeNode } from "./testHelpers"

describe("walVolume", () => {
  it("fires for materially significant WAL volume", () => {
    const node = makeNode({ operatorType: "insert", wal: { records: 50_000, fpi: 12, bytes: 3_480_000 } })
    const warnings = walVolume(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("wal-volume")
    expect(warnings[0].severity).toBe("info") // observational, per this story's own instruction
  })

  it("keeps the wording observational, not a verdict", () => {
    const node = makeNode({ wal: { bytes: 3_480_000 } })
    const [warning] = walVolume(node, makeContext(node))
    expect(warning.longText).toMatch(/plain observation, not a verdict/i)
  })

  it("does not fire below the materiality floor", () => {
    const node = makeNode({ wal: { records: 5, bytes: 1000 } })
    expect(walVolume(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when no WAL info is reported", () => {
    const node = makeNode({})
    expect(() => walVolume(node, makeContext(node))).not.toThrow()
    expect(walVolume(node, makeContext(node))).toEqual([])
  })
})
