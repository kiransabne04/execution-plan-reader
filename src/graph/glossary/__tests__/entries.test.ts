import { describe, expect, it } from "vitest"
import ENTRIES from "../entries"
import { getGlossaryEntry, getGlossaryFallback } from "../index"

// A phrase suggesting the entry drifted from general education into a
// specific-plan diagnosis — the exact blur the skill's "what this is not"
// section warns against. Not exhaustive, just a cheap tripwire.
const SPECIFIC_FINDING_LANGUAGE = /\bthis node\b|\byour plan\b|\bin your query\b/i

describe("operator glossary entries", () => {
  it("has no duplicate operatorType keys", () => {
    const seen = new Set<string>()
    for (const entry of ENTRIES) {
      expect(seen.has(entry.operatorType)).toBe(false)
      seen.add(entry.operatorType)
    }
  })

  it("never has an entry for the explicit 'unknown' normalization fallback", () => {
    expect(ENTRIES.some((e) => e.operatorType === "unknown")).toBe(false)
    expect(getGlossaryEntry("unknown")).toBeUndefined()
  })

  it.each(ENTRIES)("$operatorType: every required field is non-empty", (entry) => {
    expect(entry.displayName.length).toBeGreaterThan(0)
    expect(entry.shortDefinition.length).toBeGreaterThan(0)
    expect(entry.longDefinition.length).toBeGreaterThan(0)
    expect(entry.whenItsFine.length).toBeGreaterThan(0)
    expect(entry.whenToLookCloser.length).toBeGreaterThan(0)
  })

  it.each(ENTRIES)(
    "$operatorType: stays general — no specific-plan/specific-node language",
    (entry) => {
      for (const field of [entry.shortDefinition, entry.longDefinition, entry.whenItsFine, entry.whenToLookCloser]) {
        expect(field).not.toMatch(SPECIFIC_FINDING_LANGUAGE)
      }
    },
  )

  it("getGlossaryEntry returns the matching entry by operatorType", () => {
    const entry = getGlossaryEntry("hash_join")
    expect(entry?.displayName).toBe("Hash Join")
  })

  it("getGlossaryEntry returns undefined for an uncovered type, without throwing", () => {
    expect(() => getGlossaryEntry("some_future_operator_type")).not.toThrow()
    expect(getGlossaryEntry("some_future_operator_type")).toBeUndefined()
  })

  it("getGlossaryFallback never returns a blank message", () => {
    const fallback = getGlossaryFallback("Some Brand New Op")
    expect(fallback.displayName).toBe("Some Brand New Op")
    expect(fallback.message.length).toBeGreaterThan(0)
  })
})
