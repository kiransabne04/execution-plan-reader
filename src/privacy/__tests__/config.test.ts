import { describe, expect, it } from "vitest"
import { LLM_NARRATIVE_MODE_DEFAULT_ENABLED, PLAN_PUBLISHING_DEFAULT_ENABLED } from "../config"

// Episode 7 edge case: "LLM narrative mode accidentally becoming the
// default (config/deploy mistake) would silently break the core privacy
// promise. Explicit opt-in state must be tested as a hard default in CI —
// fails the build if the default flips." This test IS that CI check.
describe("privacy config hard defaults", () => {
  it("LLM narrative mode defaults to OFF", () => {
    expect(LLM_NARRATIVE_MODE_DEFAULT_ENABLED).toBe(false)
  })

  it("plan publishing defaults to OFF", () => {
    expect(PLAN_PUBLISHING_DEFAULT_ENABLED).toBe(false)
  })
})
