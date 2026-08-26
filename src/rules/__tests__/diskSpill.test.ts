import { describe, expect, it } from "vitest"
import { diskSpill } from "../diskSpill"
import { makeContext, makeNode } from "./testHelpers"

describe("diskSpill", () => {
  it("fires on Postgres Sort spilling to disk", () => {
    const node = makeNode({
      engine: "postgres",
      rawOperatorLabel: "Sort",
      attributes: { "Sort Space Type": "Disk", "Sort Space Used": 25000 },
    })
    const warnings = diskSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("disk-spill")
    expect(warnings[0].severity).toBe("critical")
  })

  it("does NOT fire on Postgres Sort using memory", () => {
    const node = makeNode({ engine: "postgres", rawOperatorLabel: "Sort", attributes: { "Sort Method": "quicksort" } })
    expect(diskSpill(node, makeContext(node))).toEqual([])
  })

  it("fires on Postgres Hash with Disk Usage > 0", () => {
    const node = makeNode({
      engine: "postgres",
      operatorType: "hash",
      rawOperatorLabel: "Hash",
      attributes: { "Disk Usage": 5000 },
    })
    expect(diskSpill(node, makeContext(node))).toHaveLength(1)
  })

  it("fires on SQL Server Spill Occurred", () => {
    const node = makeNode({ engine: "sqlserver", rawOperatorLabel: "Sort", attributes: { "Spill Occurred": "true" } })
    expect(diskSpill(node, makeContext(node))).toHaveLength(1)
  })

  it("does NOT fire on SQL Server without a spill", () => {
    const node = makeNode({ engine: "sqlserver", rawOperatorLabel: "Sort", attributes: {} })
    expect(diskSpill(node, makeContext(node))).toEqual([])
  })

  it("fires on Snowflake local/remote spill", () => {
    const node = makeNode({
      engine: "snowflake",
      rawOperatorLabel: "Aggregate",
      attributes: { "Spilled To Local Storage": 1024, "Spilled To Remote Storage": 2048 },
    })
    const warnings = diskSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].shortText).toContain("local disk")
    expect(warnings[0].shortText).toContain("remote disk")
  })

  it("does NOT fire on Snowflake without spill attributes", () => {
    const node = makeNode({ engine: "snowflake", rawOperatorLabel: "TableScan", attributes: {} })
    expect(diskSpill(node, makeContext(node))).toEqual([])
  })
})
