import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  decodeShareLink,
  encodeShareLink,
  SAFE_SHARE_URL_LENGTH,
  SHARE_LINK_ENVELOPE_VERSION,
} from "../shareLink"

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures")

function loadFixture(relativePath: string): string {
  return readFileSync(path.join(FIXTURES_DIR, relativePath), "utf-8")
}

const BASE_URL = "https://planreader.dev/"

describe("encodeShareLink / decodeShareLink round trip", () => {
  it("round-trips a simple plan's raw text exactly", () => {
    const text = 'SELECT * FROM Orders WHERE CustomerId = 42'
    const encoded = encodeShareLink(text, BASE_URL)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const fragment = encoded.url.split("#")[1]
    const decoded = decodeShareLink(fragment)
    expect(decoded).toEqual({ ok: true, text })
  })

  it("round-trips a real, moderately large SQL Server plan XML exactly", () => {
    const text = loadFixture("sqlserver/seek-and-key-lookup.xml")
    const encoded = encodeShareLink(text, BASE_URL)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const fragment = encoded.url.split("#")[1]
    const decoded = decodeShareLink(fragment)
    expect(decoded).toEqual({ ok: true, text })
  })

  it("uses a URL fragment, not a query parameter", () => {
    const encoded = encodeShareLink("some plan text", BASE_URL)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.url).toContain("#plan=")
    expect(encoded.url).not.toContain("?plan=")
  })

  it("strips any existing fragment from the base URL before appending the new one", () => {
    const encoded = encodeShareLink("text", `${BASE_URL}#plan=stale-old-data`)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.url.indexOf("#")).toBe(encoded.url.lastIndexOf("#"))
  })
})

/** A single repeated character compresses to almost nothing regardless of
 * length — not representative of a real large plan. Varied per-node content
 * (distinct ids/table/column names/values, as a real 100+-node plan would
 * have) is what actually resists compression and exercises this path. */
function buildOversizedPlanLikeText(nodeCount: number): string {
  let text = ""
  for (let i = 0; i < nodeCount; i++) {
    text += `<RelOp NodeId="${i}" PhysicalOp="Index Seek" Table="T${i}" Col="C${i}" Val="${Math.floor(Math.sin(i) * 1_000_000)}"/>\n`
  }
  return text
}

describe("encodeShareLink — size threshold", () => {
  it("produces an honest 'too_large' result instead of a broken/truncated link, for a deliberately oversized (varied-content) plan", () => {
    const huge = buildOversizedPlanLikeText(150)
    const encoded = encodeShareLink(huge, BASE_URL)
    expect(encoded.ok).toBe(false)
    if (encoded.ok) return
    expect(encoded.reason).toBe("too_large")
    expect(encoded.urlLength).toBeGreaterThan(SAFE_SHARE_URL_LENGTH)
  })

  it("stays within the safe length for a real, non-trivial plan fixture", () => {
    const text = loadFixture("sqlserver/seek-and-key-lookup.xml")
    const encoded = encodeShareLink(text, BASE_URL)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.url.length).toBeLessThanOrEqual(SAFE_SHARE_URL_LENGTH)
  })
})

describe("decodeShareLink — malformed/adversarial input", () => {
  it("never throws, and reports 'empty' for an empty fragment", () => {
    expect(() => decodeShareLink("")).not.toThrow()
    expect(decodeShareLink("")).toEqual({ ok: false, reason: "empty" })
  })

  it("reports 'empty' when the fragment has no plan= key at all", () => {
    expect(decodeShareLink("foo=bar")).toEqual({ ok: false, reason: "empty" })
  })

  it("reports 'malformed' for a truncated/mangled compressed value (simulates a chat app clipping the URL)", () => {
    const encoded = encodeShareLink("a reasonably long piece of plan text to compress", BASE_URL)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const fragment = encoded.url.split("#")[1]
    const truncatedFragment = fragment.slice(0, Math.floor(fragment.length / 2))
    const decoded = decodeShareLink(truncatedFragment)
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(["malformed", "empty"]).toContain(decoded.reason)
  })

  it("reports 'malformed' for garbage that isn't valid compressed data", () => {
    expect(decodeShareLink("plan=not-real-compressed-data-!!!")).toEqual({ ok: false, reason: "malformed" })
  })

  it("reports 'malformed' when the decoded envelope is well-formed JSON but not the expected shape", async () => {
    const LZString = await import("lz-string")
    const wrongShape = LZString.compressToEncodedURIComponent(JSON.stringify({ notAnEnvelope: true }))
    expect(decodeShareLink(`plan=${wrongShape}`)).toEqual({ ok: false, reason: "malformed" })
  })

  it("reports 'malformed' when 'text' is present but isn't a string", async () => {
    const LZString = await import("lz-string")
    const wrongType = LZString.compressToEncodedURIComponent(JSON.stringify({ v: 1, text: 12345 }))
    expect(decodeShareLink(`plan=${wrongType}`)).toEqual({ ok: false, reason: "malformed" })
  })
})

describe("decodeShareLink — version handling", () => {
  it("reports 'unsupported_version' for a future/unrecognized envelope version", async () => {
    const LZString = await import("lz-string")
    const badEnvelope = LZString.compressToEncodedURIComponent(JSON.stringify({ v: 999, text: "future format" }))
    const decoded = decodeShareLink(`plan=${badEnvelope}`)
    expect(decoded).toEqual({ ok: false, reason: "unsupported_version" })
  })

  it("stays at version 1 unless deliberately bumped — a reminder, not a behavior test", () => {
    expect(SHARE_LINK_ENVELOPE_VERSION).toBe(1)
  })
})
