// Episode 17 — low-level IndexedDB access shared by Story 17.1 (current-
// session persistence) and Story 17.2 (recent plans list). IndexedDB
// chosen over localStorage per the story's own decision: localStorage's
// ~5-10MB per-origin quota (shared across everything stored there) is a
// real risk for a handful of large SQL Server XML/Snowflake JSON plans;
// IndexedDB's practical limits are substantially higher. See
// docs/08-episodes-and-stories.md Episode 17 and
// .claude/skills/privacy-architecture/SKILL.md — this is local browser
// storage, never a network call, but every failure mode here must still
// degrade gracefully rather than crash the app or silently corrupt data.

const DB_NAME = "planreader"
const DB_VERSION = 1

export const SESSION_STORE = "session"
export const RECENT_PLANS_STORE = "recentPlans"

export type DbResult<T> =
  | { ok: true; value: T }
  /** `indexedDB` doesn't exist at all (very old browser), or opening it
   * threw/failed (observed in some private-browsing modes) — persistence
   * is simply unavailable this session, not an error to surface loudly. */
  | { ok: false; reason: "unavailable" }
  /** A write would exceed the browser's storage quota — must degrade to
   * session-only (no persistence) with a clear message, never a crash or
   * a silent no-op the user has no way to notice. */
  | { ok: false; reason: "quota_exceeded" }
  | { ok: false; reason: "error" }

/**
 * Opens (creating/upgrading if needed) the shared database. Resolves to
 * `null` — never rejects, never throws — whenever IndexedDB isn't usable
 * in this environment, so every caller has exactly one failure mode to
 * handle rather than a mix of thrown exceptions and rejected promises.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Safari's private-browsing mode (older versions) throws synchronously
      // here rather than failing the request asynchronously.
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(RECENT_PLANS_STORE)) {
        db.createObjectStore(RECENT_PLANS_STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

/** Exported for direct unit testing — fake-indexeddb (this project's test
 * environment for this module, since jsdom has no real IndexedDB at all)
 * doesn't enforce real storage quotas, so there's no way to trigger an
 * actual quota-exceeded write in a test. This classification logic is the
 * part that's actually ours to get right; it's tested directly against a
 * synthetic DOMException rather than through an unfakeable real one. */
export function isQuotaExceeded(error: DOMException | null | undefined): boolean {
  return error?.name === "QuotaExceededError"
}

/** Writes (creates or replaces) one record. The store's `keyPath` must
 * already be present on `value` (every record shape in this module
 * includes an explicit `id` field for exactly this reason). */
export async function putRecord<T>(storeName: string, value: T): Promise<DbResult<void>> {
  const db = await openDatabase()
  if (!db) return { ok: false, reason: "unavailable" }

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    const request = tx.objectStore(storeName).put(value)
    request.onerror = () => {
      resolve(isQuotaExceeded(request.error) ? { ok: false, reason: "quota_exceeded" } : { ok: false, reason: "error" })
    }
    tx.onabort = () => {
      resolve(isQuotaExceeded(tx.error) ? { ok: false, reason: "quota_exceeded" } : { ok: false, reason: "error" })
    }
    tx.oncomplete = () => {
      resolve({ ok: true, value: undefined })
      db.close()
    }
  })
}

export async function getRecord<T>(storeName: string, key: string): Promise<DbResult<T | undefined>> {
  const db = await openDatabase()
  if (!db) return { ok: false, reason: "unavailable" }

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly")
    const request = tx.objectStore(storeName).get(key)
    request.onerror = () => resolve({ ok: false, reason: "error" })
    tx.oncomplete = () => {
      resolve({ ok: true, value: request.result as T | undefined })
      db.close()
    }
  })
}

export async function getAllRecords<T>(storeName: string): Promise<DbResult<T[]>> {
  const db = await openDatabase()
  if (!db) return { ok: false, reason: "unavailable" }

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly")
    const request = tx.objectStore(storeName).getAll()
    request.onerror = () => resolve({ ok: false, reason: "error" })
    tx.oncomplete = () => {
      resolve({ ok: true, value: (request.result as T[]) ?? [] })
      db.close()
    }
  })
}

export async function deleteRecord(storeName: string, key: string): Promise<DbResult<void>> {
  const db = await openDatabase()
  if (!db) return { ok: false, reason: "unavailable" }

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).delete(key)
    tx.onerror = () => resolve({ ok: false, reason: "error" })
    tx.oncomplete = () => {
      resolve({ ok: true, value: undefined })
      db.close()
    }
  })
}

export async function clearStore(storeName: string): Promise<DbResult<void>> {
  const db = await openDatabase()
  if (!db) return { ok: false, reason: "unavailable" }

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).clear()
    tx.onerror = () => resolve({ ok: false, reason: "error" })
    tx.oncomplete = () => {
      resolve({ ok: true, value: undefined })
      db.close()
    }
  })
}

/** Test-only escape hatch: deletes the whole database so each test starts
 * from a clean slate. Never called from application code. */
export function _deleteDatabaseForTests(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve()
      return
    }
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
