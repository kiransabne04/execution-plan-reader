// Episode 17, Story 17.1 — persist the current pasted plan across page
// reloads. Stores the raw pasted TEXT, not the parsed PlanNode tree — same
// deliberate decision Story 11.2's shareLink.ts made and for the same
// reason: re-parsing on restore through the exact same, already-tested
// `analyzePlanText` pipeline means this module never needs to version the
// internal PlanNode shape as it evolves, only its own small envelope.
//
// This never touches the network — see .claude/skills/privacy-
// architecture/SKILL.md — but it's a new code path handling the same
// sensitive pasted content the rest of that architecture protects, so it
// gets its own explicit privacy test (persistence.privacy.test.ts) rather
// than assuming Episode 7's existing guarding covers it too.

import { deleteRecord, getRecord, putRecord, SESSION_STORE } from "./db"

/** Bump if this envelope's shape ever changes. A stored record with a
 * different version fails to load cleanly (see loadSession) rather than
 * being force-fit into the current shape. */
export const SESSION_ENVELOPE_VERSION = 1

/** Fixed key — there is only ever one "current session" record, not one
 * per visit. */
const SESSION_KEY = "current"

interface SessionRecord {
  id: string
  v: number
  text: string
  savedAt: number
}

export type SaveSessionResult = { ok: true } | { ok: false; reason: "quota_exceeded" | "unavailable" | "error" }

export async function saveSession(rawText: string): Promise<SaveSessionResult> {
  const record: SessionRecord = { id: SESSION_KEY, v: SESSION_ENVELOPE_VERSION, text: rawText, savedAt: Date.now() }
  const result = await putRecord(SESSION_STORE, record)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

export type LoadSessionResult =
  | { ok: true; text: string; savedAt: number }
  | { ok: false; reason: "none" | "unavailable" | "unsupported_version" | "malformed" | "error" }

function isWellFormedRecord(value: unknown): value is SessionRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SessionRecord).text === "string" &&
    typeof (value as SessionRecord).v === "number" &&
    typeof (value as SessionRecord).savedAt === "number"
  )
}

/**
 * Reads back the saved session, if any. Never throws — a missing record,
 * an unreadable database, a version mismatch, and outright malformed data
 * (e.g. hand-edited devtools storage, or a future incompatible format) are
 * all distinct, explicit `ok: false` reasons the caller can show a clean,
 * specific message for, rather than crashing on any of them.
 */
export async function loadSession(): Promise<LoadSessionResult> {
  const result = await getRecord<SessionRecord>(SESSION_STORE, SESSION_KEY)
  if (!result.ok) {
    // A read can never actually fail with "quota_exceeded" (that's a
    // write-only failure mode) — db.ts's DbResult type is shared across
    // reads and writes, so this narrows it back to this function's own,
    // more precise result type rather than leaking a reason that can't
    // really happen here.
    return { ok: false, reason: result.reason === "quota_exceeded" ? "error" : result.reason }
  }
  if (result.value === undefined) return { ok: false, reason: "none" }
  if (!isWellFormedRecord(result.value)) return { ok: false, reason: "malformed" }
  if (result.value.v !== SESSION_ENVELOPE_VERSION) return { ok: false, reason: "unsupported_version" }
  return { ok: true, text: result.value.text, savedAt: result.value.savedAt }
}

/** The "clear saved data" control's action. Deliberately NOT called when a
 * user just dismisses the restore banner without deleting — dismissing
 * only hides the prompt for this page load; the saved session stays
 * available to restore on a later visit until this is explicitly invoked
 * or a new plan is analyzed (which overwrites it). */
export async function clearSession(): Promise<void> {
  await deleteRecord(SESSION_STORE, SESSION_KEY)
}
