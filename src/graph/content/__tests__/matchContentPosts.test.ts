import { describe, expect, it } from "vitest"
import { matchContentPosts } from "../matchContentPosts"
import type { ContentPost } from "../posts"

// A synthetic fixture, deliberately NOT the real (currently empty)
// posts.ts — this file's own comment explains why: the match logic is
// fully testable independent of whether real content exists yet.
function makePost(overrides: Partial<ContentPost> = {}): ContentPost {
  return {
    id: overrides.id ?? "post-1",
    kind: overrides.kind ?? "blog",
    title: overrides.title ?? "A post",
    url: overrides.url ?? "https://example.com/post",
    minutes: overrides.minutes ?? 5,
    operatorTypes: overrides.operatorTypes ?? [],
    ruleIds: overrides.ruleIds ?? [],
  }
}

describe("matchContentPosts", () => {
  it("matches by operatorType", () => {
    const post = makePost({ id: "seq-scan-post", operatorTypes: ["seq_scan"] })
    const result = matchContentPosts([post], "seq_scan", [])
    expect(result.map((p) => p.id)).toEqual(["seq-scan-post"])
  })

  it("matches by a fired ruleId", () => {
    const post = makePost({ id: "spill-post", ruleIds: ["disk-spill"] })
    const result = matchContentPosts([post], "hash_join", ["disk-spill"])
    expect(result.map((p) => p.id)).toEqual(["spill-post"])
  })

  it("renders nothing (empty array) when neither operatorType nor any ruleId matches", () => {
    const post = makePost({ operatorTypes: ["seq_scan"], ruleIds: ["disk-spill"] })
    const result = matchContentPosts([post], "hash_join", ["bad-row-estimate"])
    expect(result).toEqual([])
  })

  it("a post needs only ONE matching field, not both", () => {
    const operatorOnly = makePost({ id: "a", operatorTypes: ["seq_scan"], ruleIds: [] })
    const ruleOnly = makePost({ id: "b", operatorTypes: [], ruleIds: ["disk-spill"] })
    const result = matchContentPosts([operatorOnly, ruleOnly], "seq_scan", ["disk-spill"])
    expect(result.map((p) => p.id).sort()).toEqual(["a", "b"])
  })

  it("caps at 3 matches rather than an unbounded list", () => {
    const posts = Array.from({ length: 6 }, (_, i) => makePost({ id: `p${i}`, operatorTypes: ["seq_scan"] }))
    const result = matchContentPosts(posts, "seq_scan", [])
    expect(result).toHaveLength(3)
  })

  it("orders rule-ID matches before operator-type-only matches", () => {
    const operatorMatch = makePost({ id: "operator", operatorTypes: ["seq_scan"] })
    const ruleMatch = makePost({ id: "rule", ruleIds: ["disk-spill"] })
    const result = matchContentPosts([operatorMatch, ruleMatch], "seq_scan", ["disk-spill"])
    expect(result.map((p) => p.id)).toEqual(["rule", "operator"])
  })

  it("never double-counts a post matching both fields", () => {
    const both = makePost({ id: "both", operatorTypes: ["seq_scan"], ruleIds: ["disk-spill"] })
    const result = matchContentPosts([both], "seq_scan", ["disk-spill"])
    expect(result).toHaveLength(1)
  })
})
