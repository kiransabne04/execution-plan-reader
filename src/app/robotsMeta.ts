// SEO indexing infrastructure, Requirement 6: a URL carrying a share-link
// fragment (`#plan=...`) must never become an indexable search page.
//
// This has to be a client-side, DOM-level noindex — never a robots.txt
// rule or an HTTP header — because the plan content only ever lives in a
// URL *fragment* (see `shareLink.ts`'s own doc comment: fragments are
// never sent to the server in any HTTP request, by design, for privacy).
// The server genuinely cannot tell a share-link request apart from a plain
// `/` request; only client-side JS, which reads `window.location.hash`,
// ever knows the difference. The self-referencing `<link rel="canonical">`
// already in index.html (pointing at the fragment-stripped `/`) is real,
// load-bearing defense here too — this meta tag is the second, explicit
// layer for crawlers that don't weight canonical tags as strongly.
//
// Applied/removed via a stable element id so repeated calls (React
// StrictMode double-invokes effects in development) are idempotent, never
// appending a duplicate tag.
const NOINDEX_META_ID = "share-link-noindex"

export function setShareLinkNoIndex(shouldNoIndex: boolean): void {
  const existing = document.getElementById(NOINDEX_META_ID)
  if (shouldNoIndex) {
    if (existing) return
    const meta = document.createElement("meta")
    meta.id = NOINDEX_META_ID
    meta.setAttribute("name", "robots")
    meta.setAttribute("content", "noindex, nofollow")
    document.head.appendChild(meta)
  } else {
    existing?.remove()
  }
}
