// Episode 7 — the privacy promise "the rule-based path never sends plan
// content to a server" must be structurally true, not just a policy to be
// careful about (see .claude/skills/privacy-architecture/SKILL.md). This is
// the actual technical backstop: once installed, every outbound network
// call (fetch, XMLHttpRequest, sendBeacon, WebSocket) is blocked unless its
// origin is explicitly allowlisted — which is empty by default, since
// nothing in the app is opt-in yet (Episodes 10/11 will pass their own
// endpoint's origin when they exist).
//
// Errors thrown here report only the destination's origin (protocol+host),
// never the full URL — a query string could theoretically carry data, and
// this module has no way to know that didn't happen.

export class BlockedNetworkCallError extends Error {
  constructor(kind: string, origin: string) {
    super(`Blocked outbound ${kind} request to ${origin} — this path must never make network calls.`)
    this.name = "BlockedNetworkCallError"
  }
}

interface OriginalGlobals {
  fetch?: typeof fetch
  XHROpen?: typeof XMLHttpRequest.prototype.open
  sendBeacon?: typeof navigator.sendBeacon
  WebSocket?: typeof WebSocket
}

let installed = false
let allowedOrigins = new Set<string>()
let originals: OriginalGlobals | null = null

function safeOriginOf(url: string | URL): string {
  try {
    const base = typeof location !== "undefined" ? location.href : "http://localhost"
    return new URL(url, base).origin
  } catch {
    return "(unparseable-url)"
  }
}

function assertAllowed(kind: string, url: string | URL): void {
  const origin = safeOriginOf(url)
  if (!allowedOrigins.has(origin)) {
    throw new BlockedNetworkCallError(kind, origin)
  }
}

export interface NetworkGuardOptions {
  /** Origins (e.g. "https://api.example.com") allowed through — empty by
   * default, meaning the guard blocks every outbound call. */
  allowedOrigins?: string[]
}

/** Idempotent: calling this again just updates the allowlist rather than
 * double-patching the globals. */
export function installNetworkGuard(options: NetworkGuardOptions = {}): void {
  allowedOrigins = new Set(options.allowedOrigins ?? [])
  if (installed) return
  installed = true

  // Deliberately NOT bound at capture time: a bound function is a distinct
  // object, which would break reference-equality restoration on uninstall.
  // Correct `this` binding happens at call time instead (.call/.apply
  // below), which is what real browsers require for these WebIDL methods.
  originals = {
    fetch: globalThis.fetch,
    XHROpen: globalThis.XMLHttpRequest?.prototype.open,
    sendBeacon: typeof navigator !== "undefined" ? navigator.sendBeacon : undefined,
    WebSocket: globalThis.WebSocket,
  }

  if (originals.fetch) {
    // fetch never throws synchronously — it always returns a promise that
    // rejects. `async` here preserves that contract for a blocked call too.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input
      assertAllowed("fetch", url)
      return originals!.fetch!.call(globalThis, input, init)
    }) as typeof fetch
  }

  if (typeof XMLHttpRequest !== "undefined" && originals.XHROpen) {
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      assertAllowed("XMLHttpRequest", url)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originals!.XHROpen as any).call(this, method, url, ...rest)
    } as typeof XMLHttpRequest.prototype.open
  }

  if (typeof navigator !== "undefined" && originals.sendBeacon) {
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      assertAllowed("sendBeacon", url)
      return originals!.sendBeacon!.call(navigator, url, data)
    }) as typeof navigator.sendBeacon
  }

  if (typeof WebSocket !== "undefined" && originals.WebSocket) {
    const OriginalWebSocket = originals.WebSocket
    globalThis.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        const url = args[0] as string | URL
        assertAllowed("WebSocket", url)
        return new target(...(args as ConstructorParameters<typeof WebSocket>))
      },
    })
  }
}

/** Restores the original globals — for test cleanup, and for the (unlikely)
 * case the app needs to fully disable the guard at runtime. */
export function uninstallNetworkGuard(): void {
  if (!installed || !originals) {
    installed = false
    allowedOrigins = new Set()
    return
  }
  if (originals.fetch) globalThis.fetch = originals.fetch
  if (typeof XMLHttpRequest !== "undefined" && originals.XHROpen) {
    XMLHttpRequest.prototype.open = originals.XHROpen
  }
  if (typeof navigator !== "undefined" && originals.sendBeacon) {
    navigator.sendBeacon = originals.sendBeacon
  }
  if (typeof WebSocket !== "undefined" && originals.WebSocket) {
    globalThis.WebSocket = originals.WebSocket
  }
  installed = false
  allowedOrigins = new Set()
  originals = null
}

export function isNetworkGuardInstalled(): boolean {
  return installed
}
