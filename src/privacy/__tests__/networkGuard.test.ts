import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BlockedNetworkCallError,
  installNetworkGuard,
  isNetworkGuardInstalled,
  uninstallNetworkGuard,
} from "../networkGuard"

// jsdom doesn't implement sendBeacon/WebSocket by default — stub minimal
// versions before each test so the guard has something real to patch,
// regardless of what this particular jsdom build ships with.
let originalSendBeacon: typeof navigator.sendBeacon | undefined
let originalWebSocket: typeof WebSocket | undefined

beforeEach(() => {
  originalSendBeacon = navigator.sendBeacon
  originalWebSocket = globalThis.WebSocket
  navigator.sendBeacon = vi.fn(() => true)
  globalThis.WebSocket = class {
    constructor(_url: string) {}
  } as unknown as typeof WebSocket
})

afterEach(() => {
  // Uninstall the guard's patch layer first (revealing whatever fetch was
  // underneath at install time), THEN remove any vi.stubGlobal layer
  // (revealing the true native fetch) — reversed, a stub could get baked
  // back in as the "restored" value and leak into the next test.
  uninstallNetworkGuard()
  vi.unstubAllGlobals()
  navigator.sendBeacon = originalSendBeacon as typeof navigator.sendBeacon
  globalThis.WebSocket = originalWebSocket as typeof WebSocket
})

describe("networkGuard", () => {
  it("blocks fetch to a non-allowlisted origin", async () => {
    installNetworkGuard()
    await expect(fetch("https://example.com/track")).rejects.toThrow(BlockedNetworkCallError)
  })

  it("allows fetch to an explicitly allowlisted origin", async () => {
    const fakeFetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", fakeFetch)
    installNetworkGuard({ allowedOrigins: ["https://api.example.com"] })
    await fetch("https://api.example.com/v1/thing")
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it("blocks XMLHttpRequest.open to a non-allowlisted origin", () => {
    installNetworkGuard()
    const xhr = new XMLHttpRequest()
    expect(() => xhr.open("POST", "https://evil.example.com/collect")).toThrow(BlockedNetworkCallError)
  })

  it("blocks navigator.sendBeacon to a non-allowlisted origin", () => {
    installNetworkGuard()
    expect(() => navigator.sendBeacon("https://analytics.example.com/beacon", "data")).toThrow(
      BlockedNetworkCallError,
    )
  })

  it("blocks WebSocket construction to a non-allowlisted origin", () => {
    installNetworkGuard()
    expect(() => new WebSocket("wss://example.com/socket")).toThrow(BlockedNetworkCallError)
  })

  it("never includes the full URL (only the origin) in the error, in case a query string carried data", () => {
    installNetworkGuard()
    try {
      navigator.sendBeacon("https://analytics.example.com/beacon?plan=SELECT+*+FROM+secret_table", "x")
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(BlockedNetworkCallError)
      expect((err as Error).message).not.toContain("secret_table")
      expect((err as Error).message).not.toContain("plan=")
      expect((err as Error).message).toContain("https://analytics.example.com")
    }
  })

  it("is idempotent — installing twice does not double-patch or lose the guard", async () => {
    installNetworkGuard()
    installNetworkGuard()
    expect(isNetworkGuardInstalled()).toBe(true)
    await expect(fetch("https://example.com")).rejects.toThrow(BlockedNetworkCallError)
  })

  it("updates the allowlist on a second install call without needing uninstall first", async () => {
    const fakeFetch = vi.fn(async () => new Response("ok"))
    vi.stubGlobal("fetch", fakeFetch)
    installNetworkGuard({ allowedOrigins: [] })
    installNetworkGuard({ allowedOrigins: ["https://api.example.com"] })
    await fetch("https://api.example.com/thing")
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it("uninstall restores the original fetch so normal calls work again", () => {
    const originalFetch = globalThis.fetch
    installNetworkGuard()
    expect(globalThis.fetch).not.toBe(originalFetch)
    uninstallNetworkGuard()
    expect(globalThis.fetch).toBe(originalFetch)
    expect(isNetworkGuardInstalled()).toBe(false)
  })
})
