// Episode 11, Story 11.2 — client-side-only shareable link, no backend.
// The whole plan is encoded into the URL's fragment (`#`), never a query
// parameter: fragments are never sent to a server in an HTTP request at
// all — a static host's own access logs can still capture a query string,
// but never see a fragment — which is the meaningfully stronger privacy
// property this design leans on (see docs/08-episodes-and-stories.md).
//
// Encodes the raw pasted plan TEXT, not the parsed PlanNode tree — decided
// deliberately: re-parsing on load with today's parser means this never
// needs to version the internal PlanNode shape as it evolves (the story's
// own "future-proofing" edge case), and it reuses the exact same,
// already-tested `analyzePlanText` pipeline a normal paste goes through,
// rather than a second, parallel decode-and-reconstruct path.

import * as LZString from "lz-string"

/** Bump this if the *envelope* shape here ever changes (not the PlanNode
 * model — see the module comment above for why that's a separate concern).
 * A decoder encountering a version it doesn't recognize must fail
 * gracefully (see decodeShareLink), never guess at the new shape. */
export const SHARE_LINK_ENVELOPE_VERSION = 1

/** Total URL length (including protocol/host/path) considered reliably
 * shareable across common surfaces — chat apps, SMS, etc. Modern browsers
 * individually tolerate much longer URLs, but this is the practical ceiling
 * across widely-used sharing surfaces per Story 11.2. */
export const SAFE_SHARE_URL_LENGTH = 2000

const FRAGMENT_KEY = "plan"

interface ShareEnvelope {
  v: number
  text: string
}

export type EncodeShareLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: "too_large"; urlLength: number }

export type DecodeShareLinkResult =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "malformed" | "unsupported_version" }

function buildFragment(rawText: string): string {
  const envelope: ShareEnvelope = { v: SHARE_LINK_ENVELOPE_VERSION, text: rawText }
  // compressToEncodedURIComponent's output alphabet (A-Za-z0-9+-$) never
  // collides with `=`/`&`/`#`, so it's safe to embed directly as a
  // key=value pair and parse back out with URLSearchParams.
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(envelope))
  return `${FRAGMENT_KEY}=${compressed}`
}

/**
 * Builds a shareable URL for the given raw pasted plan text, anchored at
 * `baseUrl` (defaults to the current page, fragment stripped). Returns an
 * honest `too_large` result rather than silently producing a broken or
 * truncated link when the encoded plan won't fit in a reliably-shareable
 * URL — callers must surface this to the user, not swallow it.
 */
export function encodeShareLink(rawText: string, baseUrl: string = window.location.href): EncodeShareLinkResult {
  const base = baseUrl.split("#")[0]
  const url = `${base}#${buildFragment(rawText)}`
  if (url.length > SAFE_SHARE_URL_LENGTH) {
    return { ok: false, reason: "too_large", urlLength: url.length }
  }
  return { ok: true, url }
}

/**
 * Decodes a URL fragment (e.g. `window.location.hash.slice(1)`) back into
 * the original raw plan text. Never throws: a truncated or mangled fragment
 * — common when a chat app auto-linkifies or clips a long URL — must
 * produce an honest `malformed` result so the caller can show a clear
 * message, not a blank page or a raw decode exception.
 */
export function decodeShareLink(fragment: string): DecodeShareLinkResult {
  if (!fragment) return { ok: false, reason: "empty" }

  const compressed = new URLSearchParams(fragment).get(FRAGMENT_KEY)
  if (!compressed) return { ok: false, reason: "empty" }

  let decompressed: string | null
  try {
    decompressed = LZString.decompressFromEncodedURIComponent(compressed)
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (!decompressed) return { ok: false, reason: "malformed" }

  let parsed: unknown
  try {
    parsed = JSON.parse(decompressed)
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (typeof parsed !== "object" || parsed === null || !("v" in parsed) || !("text" in parsed)) {
    return { ok: false, reason: "malformed" }
  }
  const envelope = parsed as ShareEnvelope
  if (typeof envelope.text !== "string") return { ok: false, reason: "malformed" }
  if (envelope.v !== SHARE_LINK_ENVELOPE_VERSION) return { ok: false, reason: "unsupported_version" }

  return { ok: true, text: envelope.text }
}
