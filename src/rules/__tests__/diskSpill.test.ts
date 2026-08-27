import { describe, expect, it } from "vitest"
import { diskSpill } from "../diskSpill"
import { makeContext, makeNode } from "./testHelpers"

// The rule itself is now engine-agnostic — each parser's own tests prove it
// correctly derives `spill` from that engine's raw signal (Postgres's Sort
// Space Type/Disk Usage, SQL Server's SpillToTempDb, Snowflake's bytes-
// spilled stats). This suite only needs to test the one normalized field.
describe("diskSpill", () => {
  it("fires when spill.occurred is true", () => {
    const node = makeNode({ rawOperatorLabel: "Sort", spill: { occurred: true, detail: "external sort" } })
    const warnings = diskSpill(node, makeContext(node))
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ruleId).toBe("disk-spill")
    expect(warnings[0].severity).toBe("critical")
    expect(warnings[0].shortText).toContain("external sort")
  })

  it("does NOT fire when spill is absent", () => {
    const node = makeNode({ rawOperatorLabel: "Sort" })
    expect(diskSpill(node, makeContext(node))).toEqual([])
  })

  it("does NOT fire when spill.occurred is explicitly false", () => {
    const node = makeNode({ rawOperatorLabel: "Sort", spill: { occurred: false } })
    expect(diskSpill(node, makeContext(node))).toEqual([])
  })

  it("prefers reporting byte counts (local/remote) over the generic detail string when both are available", () => {
    const node = makeNode({
      rawOperatorLabel: "Aggregate",
      spill: { occurred: true, bytesLocal: 1024, bytesRemote: 2048, detail: "should not appear" },
    })
    const [warning] = diskSpill(node, makeContext(node))
    expect(warning.shortText).toContain("1,024 bytes to local disk")
    expect(warning.shortText).toContain("2,048 bytes to remote disk")
    expect(warning.shortText).not.toContain("should not appear")
  })

  it("falls back to a generic 'to disk' when no detail is available at all", () => {
    const node = makeNode({ rawOperatorLabel: "Sort", spill: { occurred: true } })
    const [warning] = diskSpill(node, makeContext(node))
    expect(warning.shortText).toContain("Spilled to disk")
  })
})
