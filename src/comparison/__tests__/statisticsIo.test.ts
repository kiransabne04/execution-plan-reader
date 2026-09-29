import { describe, expect, it } from "vitest"
import { parseStatisticsIo } from "../../parsers/sqlserver/statisticsIo"
import { loadFixture } from "../../parsers/sqlserver/__tests__/testUtils"
import { compareStatisticsIo } from "../statisticsIo"

const load = (name: string) => parseStatisticsIo(loadFixture(name))

describe("compareStatisticsIo", () => {
  const cmp = compareStatisticsIo(load("statistics-io-before.txt"), load("statistics-io-after.txt"))

  it("headline reports the total logical-read change", () => {
    expect(cmp.headline).toBe("logical reads decreased by 99% (52,023 → 441)")
  })

  it("classifies tables as changed / added / removed, biggest logical change first", () => {
    expect(cmp.tables.map((t) => [t.table, t.status])).toEqual([
      ["Orders", "changed"],
      ["Customers", "changed"],
      ["OrderStatus", "addedInAfter"],
      ["Worktable", "removedFromAfter"],
    ])
  })

  it("computes per-metric delta and percent, with no percent when before is 0", () => {
    const orders = cmp.tables[0].metrics.find((m) => m.key === "logicalReads")!
    expect(orders).toMatchObject({ before: 48213, after: 412, delta: -47801, percent: -99 })
    const added = cmp.tables.find((t) => t.table === "OrderStatus")!.metrics.find((m) => m.key === "logicalReads")!
    expect(added).toMatchObject({ before: undefined, after: 2, delta: 2, percent: undefined })
  })

  it("compares TIME lines", () => {
    expect(cmp.time?.find((t) => t.label === "Elapsed time (ms)")).toMatchObject({ before: 1985, after: 44, delta: -1941 })
  })

  it("marks identical tables unchanged and omits headline when a side has no reads", () => {
    const same = load("statistics-io-before.txt")
    expect(compareStatisticsIo(same, same).tables.every((t) => t.status === "unchanged")).toBe(true)
    expect(compareStatisticsIo(same, { tables: [] }).headline).toBeUndefined()
  })
})
