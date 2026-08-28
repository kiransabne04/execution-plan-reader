// Episode 17, Story 17.2 — a capped, locally-stored list of recently
// analyzed plans so a user working with a handful of recurring problem
// queries doesn't have to keep the raw plan text saved elsewhere
// themselves. Explicitly local-only (PRD non-goal: no user accounts) —
// nothing here ever syncs across devices/browsers, since it's plain
// IndexedDB in this one browser profile.

import { deleteRecord, getAllRecords, putRecord, clearStore, RECENT_PLANS_STORE } from "./db"

export const RECENT_PLANS_ENVELOPE_VERSION = 1

/** Tunable, not hardcoded inline elsewhere — the oldest entry is evicted
 * once a new one would push the list past this. */
export const RECENT_PLANS_LIMIT = 10

export interface RecentPlanEntry {
  id: string
  v: number
  text: string
  rootOperatorLabel: string
  nodeCount: number
  savedAt: number
  /** Pre-built display label (root operator + node count + timestamp) —
   * built once at save time, not recomputed on every list render. Includes
   * enough distinguishing detail that two plans with the same root
   * operator don't produce ambiguous, indistinguishable entries (the
   * story's explicit edge case). */
  label: string
}

function buildLabel(rootOperatorLabel: string, nodeCount: number, savedAt: number): string {
  const time = new Date(savedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  return `${rootOperatorLabel} · ${nodeCount.toLocaleString("en-US")} node${nodeCount === 1 ? "" : "s"} · ${time}`
}

function isWellFormedEntry(value: unknown): value is RecentPlanEntry {
  const v = value as Partial<RecentPlanEntry> | null
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.text === "string" &&
    typeof v.v === "number" &&
    typeof v.savedAt === "number" &&
    typeof v.label === "string"
  )
}

export type AddRecentPlanResult = { ok: true } | { ok: false; reason: "quota_exceeded" | "unavailable" | "error" }

/**
 * Adds one entry and evicts the oldest beyond RECENT_PLANS_LIMIT. Storing
 * the entry first and evicting after (rather than checking capacity
 * first) keeps this correct even if two saves race — the eviction pass
 * always re-reads the full current list, so it self-corrects to the cap
 * regardless of how it got over.
 */
export async function addRecentPlan(
  rawText: string,
  meta: { rootOperatorLabel: string; nodeCount: number },
): Promise<AddRecentPlanResult> {
  const savedAt = Date.now()
  const entry: RecentPlanEntry = {
    id: crypto.randomUUID(),
    v: RECENT_PLANS_ENVELOPE_VERSION,
    text: rawText,
    rootOperatorLabel: meta.rootOperatorLabel,
    nodeCount: meta.nodeCount,
    savedAt,
    label: buildLabel(meta.rootOperatorLabel, meta.nodeCount, savedAt),
  }

  const putResult = await putRecord(RECENT_PLANS_STORE, entry)
  if (!putResult.ok) return putResult

  const allResult = await getAllRecords<RecentPlanEntry>(RECENT_PLANS_STORE)
  if (allResult.ok) {
    const sorted = [...allResult.value].sort(compareBySavedAtDesc)
    const toEvict = sorted.slice(RECENT_PLANS_LIMIT)
    for (const stale of toEvict) await deleteRecord(RECENT_PLANS_STORE, stale.id)
  }

  return { ok: true }
}

/** `savedAt` (Date.now(), 1ms resolution) descending, with `id` as a
 * deterministic tiebreaker for entries saved within the same millisecond
 * — the store's own iteration order (getAllRecords) is by key (a random
 * UUID), not insertion order, so without this a tie's relative order
 * would be arbitrary rather than merely "not meaningfully ordered." */
function compareBySavedAtDesc(a: RecentPlanEntry, b: RecentPlanEntry): number {
  if (a.savedAt !== b.savedAt) return b.savedAt - a.savedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Newest first. Silently skips any malformed/unrecognized-version entry
 * rather than crashing the whole list on one bad record (the same
 * tolerant-of-corruption stance sessionPersistence.ts takes, applied per-
 * entry here since one list holds many independent records). */
export async function listRecentPlans(): Promise<RecentPlanEntry[]> {
  const result = await getAllRecords<RecentPlanEntry>(RECENT_PLANS_STORE)
  if (!result.ok) return []
  return result.value
    .filter((entry) => isWellFormedEntry(entry) && entry.v === RECENT_PLANS_ENVELOPE_VERSION)
    .sort(compareBySavedAtDesc)
}

export async function deleteRecentPlan(id: string): Promise<void> {
  await deleteRecord(RECENT_PLANS_STORE, id)
}

export async function clearAllRecentPlans(): Promise<void> {
  await clearStore(RECENT_PLANS_STORE)
}
