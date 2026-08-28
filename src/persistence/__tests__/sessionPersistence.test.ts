import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { saveSession, loadSession, clearSession, SESSION_ENVELOPE_VERSION } from "../sessionPersistence"
import { putRecord, SESSION_STORE, _deleteDatabaseForTests } from "../db"

beforeEach(async () => {
  await _deleteDatabaseForTests()
})
afterEach(async () => {
  await _deleteDatabaseForTests()
})

describe("sessionPersistence", () => {
  it("returns 'none' when nothing has been saved yet", async () => {
    const result = await loadSession()
    expect(result).toEqual({ ok: false, reason: "none" })
  })

  it("save then load restores the exact same text", async () => {
    const text = "some pasted plan text\nwith multiple lines"
    const saveResult = await saveSession(text)
    expect(saveResult).toEqual({ ok: true })

    const loadResult = await loadSession()
    expect(loadResult.ok).toBe(true)
    if (loadResult.ok) {
      expect(loadResult.text).toBe(text)
      expect(loadResult.savedAt).toBeGreaterThan(0)
    }
  })

  it("a second save overwrites the first — only one session record ever exists", async () => {
    await saveSession("first plan")
    await saveSession("second plan")

    const loadResult = await loadSession()
    expect(loadResult.ok).toBe(true)
    if (loadResult.ok) expect(loadResult.text).toBe("second plan")
  })

  it("clearSession removes the saved record", async () => {
    await saveSession("some plan")
    await clearSession()

    const loadResult = await loadSession()
    expect(loadResult).toEqual({ ok: false, reason: "none" })
  })

  it("a version mismatch fails cleanly as 'unsupported_version', not a crash on load", async () => {
    await putRecord(SESSION_STORE, { id: "current", v: SESSION_ENVELOPE_VERSION + 1, text: "future format", savedAt: Date.now() })

    const result = await loadSession()
    expect(result).toEqual({ ok: false, reason: "unsupported_version" })
  })

  it("malformed stored data fails cleanly as 'malformed', not a crash on load", async () => {
    await putRecord(SESSION_STORE, { id: "current", v: SESSION_ENVELOPE_VERSION, notText: 42 })

    const result = await loadSession()
    expect(result).toEqual({ ok: false, reason: "malformed" })
  })

  it("does not throw and reports 'unavailable' when indexedDB doesn't exist in this environment", async () => {
    const original = globalThis.indexedDB
    // @ts-expect-error -- deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB

    try {
      const saveResult = await saveSession("some plan")
      expect(saveResult).toEqual({ ok: false, reason: "unavailable" })
      const loadResult = await loadSession()
      expect(loadResult).toEqual({ ok: false, reason: "unavailable" })
    } finally {
      globalThis.indexedDB = original
    }
  })
})
