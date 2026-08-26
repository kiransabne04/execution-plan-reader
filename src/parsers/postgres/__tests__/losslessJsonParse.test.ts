import { describe, expect, it } from "vitest"
import { isDuplicateKeyMerge, parseLosslessJson } from "../losslessJsonParse"
import { PlanParseError } from "../../normalize"
import { loadFixture } from "./testUtils"

describe("parseLosslessJson", () => {
  it("parses ordinary objects/arrays/scalars like standard JSON", () => {
    const value = parseLosslessJson(
      '{"a": 1, "b": [1, 2, 3], "c": "hi", "d": true, "e": null, "f": 1.5e2}',
    )
    expect(value).toEqual({ a: 1, b: [1, 2, 3], c: "hi", d: true, e: null, f: 150 })
  })

  it("merges duplicate keys into an array instead of dropping one (core non-negotiable rule)", () => {
    const value = parseLosslessJson('{"Workers": ["a"], "Workers": ["b"]}') as Record<
      string,
      unknown
    >
    expect(isDuplicateKeyMerge(value.Workers)).toBe(true)
    expect(value.Workers).toEqual([["a"], ["b"]])
  })

  it("does not falsely flag a normal array value as a duplicate-key merge", () => {
    const value = parseLosslessJson('{"Plans": [1, 2]}') as Record<string, unknown>
    expect(isDuplicateKeyMerge(value.Plans)).toBe(false)
  })

  it("parses the duplicate-workers-key fixture without losing either block", () => {
    const raw = loadFixture("duplicate-workers-key.json")
    const parsed = parseLosslessJson(raw) as unknown[]
    const plan = (parsed[0] as Record<string, unknown>).Plan as Record<string, unknown>
    expect(isDuplicateKeyMerge(plan.Workers)).toBe(true)
    const merged = plan.Workers as unknown[]
    expect(merged).toHaveLength(2)
  })

  it("throws a structural TRUNCATED_INPUT error on unexpected end of input", () => {
    try {
      parseLosslessJson('{"Node Type": "Seq Scan"')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("TRUNCATED_INPUT")
      // Structural only — never echoes the raw input back.
      expect((err as PlanParseError).message).not.toContain("Seq Scan")
    }
  })

  it("throws a structural INVALID_JSON error on malformed syntax", () => {
    try {
      parseLosslessJson("{not valid json}")
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("INVALID_JSON")
    }
  })

  it("handles escaped characters and unicode escapes in strings", () => {
    const value = parseLosslessJson('{"s": "line1\\nline2\\t\\u00e9"}') as Record<
      string,
      unknown
    >
    expect(value.s).toBe("line1\nline2\té")
  })
})
