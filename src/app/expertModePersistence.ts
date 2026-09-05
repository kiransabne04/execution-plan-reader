// Design review, spec §1f: "The mode is sticky across sessions
// (localStorage); an expert sets it once." localStorage (not
// sessionStorage — Story 9.1's callout dismissal uses that instead, for
// the opposite reason: THIS should survive a fresh visit, that shouldn't).
//
// Wrapped defensively, same pattern as calloutDismissal.ts: localStorage
// can throw (privacy extensions, some private-browsing modes) — this must
// degrade to "not remembered" (defaulting to Beginner, the safer default
// for a first-time visitor), never crash the shell and never silently
// throw past the caller.

const STORAGE_KEY = "planreader.expert-mode"

export function loadExpertMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

export function saveExpertMode(expertMode: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(expertMode))
  } catch {
    // Storage blocked — the toggle still works for the current session via
    // the caller's own component state; it just won't persist across a
    // reload. Never throw past this point.
  }
}
