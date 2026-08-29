import { describe, expect, it } from "vitest"
import { formatBytesCompact } from "../format"

describe("formatBytesCompact", () => {
  it("scales to MB for a value in that range", () => {
    expect(formatBytesCompact(104_857_600)).toBe("100 MB") // 100 * 1024^2
  })

  it("scales to KB for a small value", () => {
    expect(formatBytesCompact(51_200)).toBe("50 KB") // 50 * 1024
  })

  it("stays in plain bytes below 1024", () => {
    expect(formatBytesCompact(512)).toBe("512 B")
  })

  it("scales to GB for a large value", () => {
    expect(formatBytesCompact(1_610_612_736)).toBe("1.5 GB") // 1.5 * 1024^3
  })

  it("rounds to a whole number at or above 100 of a unit, one decimal below it", () => {
    expect(formatBytesCompact(150 * 1024 * 1024)).toBe("150 MB")
    expect(formatBytesCompact(1.5 * 1024)).toBe("1.5 KB")
  })

  it("never produces NaN/Infinity/negative output on degenerate input", () => {
    expect(formatBytesCompact(0)).toBe("0 B")
    expect(formatBytesCompact(-5)).toBe("0 B")
    expect(formatBytesCompact(Number.NaN)).not.toMatch(/NaN/)
    expect(formatBytesCompact(Number.POSITIVE_INFINITY)).not.toMatch(/Infinity/)
  })
})
