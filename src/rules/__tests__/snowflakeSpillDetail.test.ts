import { describe, expect, it } from "vitest"
import { bytesSeverity, LOCAL_SPILL_CRITICAL_BYTES, LOCAL_SPILL_WARNING_BYTES, REMOTE_SPILL_CRITICAL_BYTES, REMOTE_SPILL_WARNING_BYTES } from "../snowflakeSpillDetail"

describe("bytesSeverity", () => {
  it("returns undefined below the warning floor", () => {
    expect(bytesSeverity(50, 100, 1_000)).toBeUndefined()
  })

  it("returns warning between the floors", () => {
    expect(bytesSeverity(500, 100, 1_000)).toBe("warning")
  })

  it("returns critical at or above the critical floor", () => {
    expect(bytesSeverity(1_000, 100, 1_000)).toBe("critical")
  })

  it("remote thresholds are lower than local's — the same byte count is at least as severe remotely", () => {
    // A 50MB spill: below local's warning floor (100MB) but above
    // remote's critical floor (100MB)... check with a concrete number
    // that clearly demonstrates the comparative severity requirement.
    const bytes = REMOTE_SPILL_CRITICAL_BYTES // 100 MB
    expect(bytesSeverity(bytes, REMOTE_SPILL_WARNING_BYTES, REMOTE_SPILL_CRITICAL_BYTES)).toBe("critical")
    expect(bytesSeverity(bytes, LOCAL_SPILL_WARNING_BYTES, LOCAL_SPILL_CRITICAL_BYTES)).toBe("warning")
  })
})
