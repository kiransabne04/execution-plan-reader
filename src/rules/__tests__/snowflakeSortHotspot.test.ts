import { describe, expect, it } from "vitest"
import { snowflakeSortHotspot } from "../snowflakeSortHotspot"
import { makeContext, makeNode } from "./testHelpers"

describe("snowflakeSortHotspot", () => {
  it("fires as info on material time share with no spill", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", timeBreakdown: { overallPercentage: 15 } })
    const warnings = snowflakeSortHotspot(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("sort-hotspot")
    expect(warnings[0].severity).toBe("info")
  })

  it("escalates severity to warning on a local spill crossing the warning floor", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", spill: { occurred: true, bytesLocal: 200 * 1024 * 1024 } })
    const warnings = snowflakeSortHotspot(node, makeContext(node))
    expect(warnings[0].severity).toBe("warning")
  })

  it("escalates severity higher for remote spill than an equivalent local spill", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", spill: { occurred: true, bytesRemote: 20 * 1024 * 1024 } })
    const warnings = snowflakeSortHotspot(node, makeContext(node))
    expect(warnings[0].severity).toBe("warning")
  })

  it("marks critical at the critical remote-spill floor", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", spill: { occurred: true, bytesRemote: 200 * 1024 * 1024 } })
    expect(snowflakeSortHotspot(node, makeContext(node))[0].severity).toBe("critical")
  })

  it("applies to sort_with_limit too", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort_with_limit", timeBreakdown: { overallPercentage: 20 } })
    expect(snowflakeSortHotspot(node, makeContext(node))).toHaveLength(1)
  })

  it("does not fire below both the time-share and spill floors", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", timeBreakdown: { overallPercentage: 1 }, spill: { occurred: true, bytesLocal: 1024 } })
    expect(snowflakeSortHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-sort operator", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "aggregate", timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeSortHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not fire for a non-Snowflake engine", () => {
    const node = makeNode({ engine: "postgres", operatorType: "sort", timeBreakdown: { overallPercentage: 50 } })
    expect(snowflakeSortHotspot(node, makeContext(node))).toEqual([])
  })

  it("does not use Postgres's work_mem wording", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort", spill: { occurred: true, bytesLocal: 200 * 1024 * 1024 } })
    const longText = snowflakeSortHotspot(node, makeContext(node))[0].longText
    expect(longText.toLowerCase()).not.toContain("work_mem")
  })

  it("does not throw with no timeBreakdown or spill data at all", () => {
    const node = makeNode({ engine: "snowflake", operatorType: "sort" })
    expect(() => snowflakeSortHotspot(node, makeContext(node))).not.toThrow()
    expect(snowflakeSortHotspot(node, makeContext(node))).toEqual([])
  })
})
