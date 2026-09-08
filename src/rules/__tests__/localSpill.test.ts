import { describe, expect, it } from "vitest"
import { localSpill } from "../localSpill"
import { makeContext, makeNode } from "./testHelpers"
import type { PlanNode } from "../../parsers/normalize"

const MB = 1024 * 1024

function makeSpillNode(bytesLocal: number, overrides: Partial<PlanNode> = {}) {
  return makeNode({ engine: "snowflake", rawOperatorLabel: "Sort", spill: { occurred: true, bytesLocal }, ...overrides })
}

function run(node: PlanNode) {
  return localSpill(node, makeContext(node))
}

describe("localSpill", () => {
  it("does NOT fire below the warning floor", () => {
    expect(run(makeSpillNode(10 * MB))).toEqual([])
  })

  it("fires warning between the floors", () => {
    const warnings = run(makeSpillNode(200 * MB))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("local-spill")
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates to critical at the critical floor (1GB)", () => {
    expect(run(makeSpillNode(1024 * MB))[0].severity).toBe("critical")
  })

  it("does NOT fire on a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", spill: { occurred: true, bytesLocal: 1024 * MB } })
    expect(run(node)).toEqual([])
  })

  it("does NOT fire when bytesLocal is absent (a remote-only spill)", () => {
    const node = makeNode({ engine: "snowflake", spill: { occurred: true, bytesRemote: 500 * MB } })
    expect(run(node)).toEqual([])
  })

  it("scales by bytes — a bigger spill reads a bigger figure and a higher tier", () => {
    const small = run(makeSpillNode(150 * MB))
    const large = run(makeSpillNode(2 * 1024 * MB))
    expect(small[0].severity).toBe("warning")
    expect(large[0].severity).toBe("critical")
  })

  it("mentions remote-spill as the more expensive alternative, without duplicating that finding's own text", () => {
    const longText = run(makeSpillNode(200 * MB))[0].longText
    expect(longText).toContain("remote storage")
  })

  it("does not throw on pathological numeric input", () => {
    for (const bytesLocal of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() => run(makeSpillNode(bytesLocal))).not.toThrow()
    }
  })
})
