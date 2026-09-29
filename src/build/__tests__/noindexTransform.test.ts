import { describe, expect, it } from "vitest"
import { injectNoindexForNonProduction } from "../noindexTransform"

const HTML = "<html><head><title>x</title></head><body></body></html>"

describe("injectNoindexForNonProduction", () => {
  it("does not inject anything when VERCEL_ENV is production", () => {
    expect(injectNoindexForNonProduction(HTML, "production")).toBe(HTML)
  })

  it("does not inject anything when VERCEL_ENV is unset (local dev/build)", () => {
    expect(injectNoindexForNonProduction(HTML, undefined)).toBe(HTML)
  })

  it("injects a noindex/nofollow meta tag when VERCEL_ENV is preview", () => {
    const result = injectNoindexForNonProduction(HTML, "preview")
    expect(result).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(result).not.toBe(HTML)
  })

  it("injects a noindex/nofollow meta tag when VERCEL_ENV is development (Vercel's own value, not local dev)", () => {
    const result = injectNoindexForNonProduction(HTML, "development")
    expect(result).toContain('<meta name="robots" content="noindex, nofollow" />')
  })

  it("injects the tag right before </head>, not anywhere else", () => {
    const result = injectNoindexForNonProduction(HTML, "preview")
    expect(result).toBe('<html><head><title>x</title>    <meta name="robots" content="noindex, nofollow" />\n  </head><body></body></html>')
  })

  it("is a no-op (returns the input unchanged) when the HTML has no </head> to anchor on", () => {
    const malformed = "<html><body>no head tag</body></html>"
    expect(injectNoindexForNonProduction(malformed, "preview")).toBe(malformed)
  })
})
