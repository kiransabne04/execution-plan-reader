// Session-scoped dismissal for funnel callouts (Story 9.1). Keyed per
// product, not per node — dismissing pgsuite hides it for the rest of the
// browser session across every node, since reappearing on every single node
// clicked would itself become the "generic banner" experience the story
// explicitly avoids. Dismissal is intentionally NOT permanent (sessionStorage,
// not localStorage) — a fresh visit gets a clean slate.

const STORAGE_PREFIX = "planreader.callout-dismissed."

/**
 * Wrapped defensively: sessionStorage can throw (privacy extensions, some
 * private-browsing modes) — this must degrade to "always show," never crash
 * the panel and never silently become "always hidden" either, per Story
 * 9.1's ad-blocker/privacy-extension edge case.
 */
export function isCalloutDismissed(product: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + product) === "true"
  } catch {
    return false
  }
}

export function dismissCallout(product: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + product, "true")
  } catch {
    // Storage blocked — the click still dismisses the callout for the
    // current render via the caller's own component state; it just won't
    // persist across a re-mount. Never throw past this point.
  }
}
