import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addRecentPlan, listRecentPlans, deleteRecentPlan, clearAllRecentPlans, RECENT_PLANS_LIMIT } from "../recentPlans"
import { _deleteDatabaseForTests, putRecord, RECENT_PLANS_STORE } from "../db"

beforeEach(async () => {
  await _deleteDatabaseForTests()
})
afterEach(async () => {
  await _deleteDatabaseForTests()
  vi.restoreAllMocks()
})

describe("recentPlans", () => {
  it("starts empty", async () => {
    expect(await listRecentPlans()).toEqual([])
  })

  it("adding a plan makes it appear in the list, newest first", async () => {
    await addRecentPlan("plan A text", { rootOperatorLabel: "Hash Join", nodeCount: 5 })
    await addRecentPlan("plan B text", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })

    const list = await listRecentPlans()
    expect(list).toHaveLength(2)
    expect(list[0].text).toBe("plan B text") // most recently added first
    expect(list[1].text).toBe("plan A text")
  })

  it("caps at RECENT_PLANS_LIMIT, evicting the oldest entry on overflow", async () => {
    // A real user's saves are always naturally spaced out in time; a tight
    // synchronous loop like this test can otherwise tie on Date.now()'s
    // 1ms resolution, which would make "the oldest" ambiguous — mock
    // Date.now() to return a strictly increasing value per call so the
    // test's own timing artifact doesn't undermine what it's checking.
    let clock = 1000
    vi.spyOn(Date, "now").mockImplementation(() => clock++)

    for (let i = 0; i < RECENT_PLANS_LIMIT + 3; i++) {
      await addRecentPlan(`plan ${i}`, { rootOperatorLabel: "Seq Scan", nodeCount: 1 })
    }

    const list = await listRecentPlans()
    expect(list).toHaveLength(RECENT_PLANS_LIMIT)
    // The 3 oldest (0, 1, 2) were evicted; the newest RECENT_PLANS_LIMIT remain.
    expect(list.map((e) => e.text)).not.toContain("plan 0")
    expect(list.map((e) => e.text)).not.toContain("plan 1")
    expect(list.map((e) => e.text)).not.toContain("plan 2")
    expect(list.map((e) => e.text)).toContain(`plan ${RECENT_PLANS_LIMIT + 2}`)
  })

  it("individually deletable by id", async () => {
    await addRecentPlan("keep me", { rootOperatorLabel: "Hash Join", nodeCount: 3 })
    await addRecentPlan("delete me", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })

    const before = await listRecentPlans()
    const toDelete = before.find((e) => e.text === "delete me")!
    await deleteRecentPlan(toDelete.id)

    const after = await listRecentPlans()
    expect(after).toHaveLength(1)
    expect(after[0].text).toBe("keep me")
  })

  it("clearAllRecentPlans empties the whole list", async () => {
    await addRecentPlan("a", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })
    await addRecentPlan("b", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })
    await clearAllRecentPlans()

    expect(await listRecentPlans()).toEqual([])
  })

  it("includes enough distinguishing detail (node count + timestamp) that two plans with the same root operator get different labels", async () => {
    await addRecentPlan("a", { rootOperatorLabel: "Seq Scan", nodeCount: 5 })
    await addRecentPlan("b", { rootOperatorLabel: "Seq Scan", nodeCount: 12 })

    const list = await listRecentPlans()
    expect(list[0].label).not.toBe(list[1].label)
    expect(list.some((e) => e.label.includes("5 node"))).toBe(true)
    expect(list.some((e) => e.label.includes("12 node"))).toBe(true)
  })

  it("skips a malformed or version-mismatched stored entry rather than crashing the whole list on one bad record", async () => {
    await addRecentPlan("good entry", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })
    // Simulates data from an older, incompatible schema version — same
    // forward-compatibility concern as sessionPersistence.ts and Story
    // 11.2's link-encoding versioning.
    await putRecord(RECENT_PLANS_STORE, { id: "stale", v: 999, text: "old format", label: "stale" })
    await putRecord(RECENT_PLANS_STORE, { id: "broken", notEvenTheRightShape: true })

    const list = await listRecentPlans()
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe("good entry")
  })

  it("does not throw when indexedDB is unavailable — degrades to an empty list / a reported failure", async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error -- deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB

    try {
      const addResult = await addRecentPlan("x", { rootOperatorLabel: "Seq Scan", nodeCount: 1 })
      expect(addResult).toEqual({ ok: false, reason: "unavailable" })
      expect(await listRecentPlans()).toEqual([])
    } finally {
      globalThis.indexedDB = original
    }
  })
})
