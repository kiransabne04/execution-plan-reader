import { describe, expect, it } from "vitest"
import { temporaryIo } from "../temporaryIo"
import { makeContext, makeNode } from "./testHelpers"

describe("temporaryIo", () => {
  it("fires for material temp I/O", () => {
    const node = makeNode({ io: { tempReadBlocks: 5_000, tempWrittenBlocks: 5_000 } })
    const warnings = temporaryIo(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("temp-io")
  })

  it("relates itself to an existing disk-based sort on the same node, rather than presenting it as unrelated", () => {
    const node = makeNode({ io: { tempReadBlocks: 5_000, tempWrittenBlocks: 5_000 }, sort: { spaceType: "disk", spaceUsedKb: 40_000 } })
    const [warning] = temporaryIo(node, makeContext(node))
    expect(warning.longText).toMatch(/matches the disk-based sort/i)
  })

  it("relates itself to multi-batch hash processing on the same node", () => {
    const node = makeNode({ io: { tempReadBlocks: 5_000, tempWrittenBlocks: 5_000 }, hash: { batches: 4 } })
    const [warning] = temporaryIo(node, makeContext(node))
    expect(warning.longText).toMatch(/matches the multi-batch hash processing/i)
  })

  it("does not fire below the block-count materiality floor", () => {
    const node = makeNode({ io: { tempReadBlocks: 10, tempWrittenBlocks: 10 } })
    expect(temporaryIo(node, makeContext(node))).toEqual([])
  })

  it("does not fire and does not throw when no temp I/O is reported", () => {
    const node = makeNode({})
    expect(() => temporaryIo(node, makeContext(node))).not.toThrow()
    expect(temporaryIo(node, makeContext(node))).toEqual([])
  })
})
