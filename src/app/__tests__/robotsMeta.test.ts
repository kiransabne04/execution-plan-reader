import { afterEach, describe, expect, it } from "vitest"
import { setShareLinkNoIndex } from "../robotsMeta"

function findNoIndexMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="robots"][content="noindex, nofollow"]')
}

afterEach(() => {
  setShareLinkNoIndex(false)
})

describe("setShareLinkNoIndex", () => {
  it("adds a noindex/nofollow meta tag to <head> when called with true", () => {
    expect(findNoIndexMeta()).toBeNull()
    setShareLinkNoIndex(true)
    expect(findNoIndexMeta()).not.toBeNull()
  })

  it("removes the tag when called with false", () => {
    setShareLinkNoIndex(true)
    expect(findNoIndexMeta()).not.toBeNull()
    setShareLinkNoIndex(false)
    expect(findNoIndexMeta()).toBeNull()
  })

  it("is idempotent — calling true twice never appends a duplicate tag", () => {
    setShareLinkNoIndex(true)
    setShareLinkNoIndex(true)
    expect(document.querySelectorAll('meta[name="robots"]')).toHaveLength(1)
  })

  it("calling false when no tag exists is a harmless no-op", () => {
    expect(() => setShareLinkNoIndex(false)).not.toThrow()
    expect(findNoIndexMeta()).toBeNull()
  })
})
