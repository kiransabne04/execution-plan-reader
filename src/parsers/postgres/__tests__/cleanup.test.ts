import { describe, expect, it } from "vitest"
import { cleanup } from "../cleanup"

describe("cleanup", () => {
  it("normalizes CRLF line endings to LF", () => {
    expect(cleanup("line1\r\nline2\r\n")).toBe("line1\nline2")
  })

  it("trims leading/trailing whitespace and blank lines", () => {
    expect(cleanup("\n\n  { \"a\": 1 }  \n\n")).toBe('{ "a": 1 }')
  })

  it("strips a leading auto_explain LOG:/timestamp prefix on the first content line", () => {
    const input = '2024-01-01 12:00:00 UTC LOG:  duration: 1.2 ms  plan:\n{"Node Type": "Seq Scan"}'
    expect(cleanup(input)).toBe('duration: 1.2 ms  plan:\n{"Node Type": "Seq Scan"}')
  })

  it("leaves plain JSON with no artifacts untouched (aside from trimming)", () => {
    expect(cleanup('{"Node Type": "Seq Scan"}')).toBe('{"Node Type": "Seq Scan"}')
  })
})
