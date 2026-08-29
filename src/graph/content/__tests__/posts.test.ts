import { describe, expect, it } from "vitest"
import { POSTS } from "../posts"
import { coveredOperatorTypes } from "../../glossary"
import { KNOWN_RULE_FAMILIES } from "../../../rules/findingCategory"

// Episode 18, Story 18.13's own edge case: "A post's operatorTypes/ruleIds
// referencing a value that no longer exists (a rule renamed, an operator
// type remapped) — silent content drift." Same "seen but unmapped"
// tracking discipline the plan-normalization skill already requires of
// operator-type tables, applied here to `posts.ts` entries. `POSTS` is
// currently empty (see that file's own comment), so this trivially passes
// today — its job is to fail LOUDLY and specifically the moment a future
// real entry's `operatorTypes`/`ruleIds` typo or drift from the rest of
// the codebase, rather than silently shipping a dead link.
describe("posts.ts content integrity", () => {
  it("every entry's operatorTypes are real, currently-covered operator types", () => {
    const covered = new Set(coveredOperatorTypes())
    for (const post of POSTS) {
      for (const operatorType of post.operatorTypes) {
        expect(covered.has(operatorType), `posts.ts entry "${post.id}" references unknown operatorType "${operatorType}"`).toBe(true)
      }
    }
  })

  it("every entry's ruleIds are real, currently-known rule families", () => {
    const known = new Set(KNOWN_RULE_FAMILIES)
    for (const post of POSTS) {
      for (const ruleId of post.ruleIds) {
        expect(known.has(ruleId), `posts.ts entry "${post.id}" references unknown ruleId "${ruleId}"`).toBe(true)
      }
    }
  })

  it("has unique ids", () => {
    const ids = POSTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
