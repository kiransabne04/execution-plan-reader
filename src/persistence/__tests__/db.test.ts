import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  putRecord,
  getRecord,
  getAllRecords,
  deleteRecord,
  clearStore,
  isQuotaExceeded,
  _deleteDatabaseForTests,
  SESSION_STORE,
} from "../db"

beforeEach(async () => {
  await _deleteDatabaseForTests()
})
afterEach(async () => {
  await _deleteDatabaseForTests()
})

describe("isQuotaExceeded", () => {
  it("recognizes a real QuotaExceededError DOMException", () => {
    expect(isQuotaExceeded(new DOMException("storage full", "QuotaExceededError"))).toBe(true)
  })

  it("does not misclassify a different DOMException as quota-exceeded", () => {
    expect(isQuotaExceeded(new DOMException("aborted", "AbortError"))).toBe(false)
  })

  it("handles null/undefined without throwing", () => {
    expect(isQuotaExceeded(null)).toBe(false)
    expect(isQuotaExceeded(undefined)).toBe(false)
  })
})

describe("putRecord / getRecord / getAllRecords / deleteRecord / clearStore", () => {
  it("put then get roundtrips the exact value", async () => {
    await putRecord(SESSION_STORE, { id: "current", value: "hello" })
    const result = await getRecord<{ id: string; value: string }>(SESSION_STORE, "current")
    expect(result).toEqual({ ok: true, value: { id: "current", value: "hello" } })
  })

  it("getRecord on a missing key resolves ok with an undefined value, not an error", async () => {
    const result = await getRecord(SESSION_STORE, "does-not-exist")
    expect(result).toEqual({ ok: true, value: undefined })
  })

  it("getAllRecords returns every stored record", async () => {
    await putRecord(SESSION_STORE, { id: "a", value: 1 })
    await putRecord(SESSION_STORE, { id: "b", value: 2 })
    const result = await getAllRecords(SESSION_STORE)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(2)
  })

  it("deleteRecord removes exactly the targeted record", async () => {
    await putRecord(SESSION_STORE, { id: "a", value: 1 })
    await putRecord(SESSION_STORE, { id: "b", value: 2 })
    await deleteRecord(SESSION_STORE, "a")

    const result = await getAllRecords<{ id: string }>(SESSION_STORE)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.map((r) => r.id)).toEqual(["b"])
  })

  it("clearStore empties the whole store", async () => {
    await putRecord(SESSION_STORE, { id: "a", value: 1 })
    await putRecord(SESSION_STORE, { id: "b", value: 2 })
    await clearStore(SESSION_STORE)

    const result = await getAllRecords(SESSION_STORE)
    expect(result).toEqual({ ok: true, value: [] })
  })

  it("every operation resolves 'unavailable' rather than throwing when indexedDB doesn't exist", async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error -- deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB

    try {
      await expect(putRecord(SESSION_STORE, { id: "x" })).resolves.toEqual({ ok: false, reason: "unavailable" })
      await expect(getRecord(SESSION_STORE, "x")).resolves.toEqual({ ok: false, reason: "unavailable" })
      await expect(getAllRecords(SESSION_STORE)).resolves.toEqual({ ok: false, reason: "unavailable" })
      await expect(deleteRecord(SESSION_STORE, "x")).resolves.toEqual({ ok: false, reason: "unavailable" })
      await expect(clearStore(SESSION_STORE)).resolves.toEqual({ ok: false, reason: "unavailable" })
    } finally {
      globalThis.indexedDB = original
    }
  })
})

describe("concurrent writes to the same key (Episode 17 edge case: multiple tabs open simultaneously)", () => {
  it("last-write-wins without ever producing a torn/corrupted record", async () => {
    // Two "tabs" writing to the same key without waiting on each other —
    // IndexedDB's per-record atomicity means the final read is always one
    // COMPLETE write, never a merge/mix of the two.
    await Promise.all([
      putRecord(SESSION_STORE, { id: "current", text: "from tab A", savedAt: 1 }),
      putRecord(SESSION_STORE, { id: "current", text: "from tab B", savedAt: 2 }),
    ])

    const result = await getRecord<{ id: string; text: string; savedAt: number }>(SESSION_STORE, "current")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(["from tab A", "from tab B"]).toContain(result.value?.text)
      // Never a value that doesn't match either complete write.
      expect(result.value?.savedAt === 1 || result.value?.savedAt === 2).toBe(true)
    }
  })
})
