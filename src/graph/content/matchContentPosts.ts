// Episode 18, Story 18.13 — pure match logic, kept separate from the React
// wrapper (ContentStack.tsx) so it's testable against a SYNTHETIC posts
// fixture (the real, shipped posts.ts starts empty — see that file's own
// comment) — same "testable logic, separate from its React wrapper" split
// this codebase already uses (buildGraphElements.ts, searchNodes.ts,
// walkthroughSteps.ts).

import type { ContentPost } from "./posts"

/** A small cap, not an unbounded list — consistent with this project's
 * general "cap with an option to expand" pattern (Story 5.1's per-node
 * warning cap). No "see more" affordance exists for this cap specifically
 * since a node realistically matches at most a couple of genuinely
 * relevant posts; revisit if that assumption stops holding once real
 * content exists. */
const MAX_MATCHES = 3

/**
 * Matches on the open node's `operatorType` OR any of its fired
 * `Warning.ruleId`s (spec §5 `2c`) — a post needs only ONE matching field,
 * not both. Order: rule-ID matches first (a specific finding is more
 * actionable than general operator education), then operator-type
 * matches, each in `posts`'s own array order — deterministic, not
 * re-sorted by relevance scoring this spec doesn't call for.
 */
export function matchContentPosts(posts: ContentPost[], operatorType: string, ruleIds: string[]): ContentPost[] {
  const ruleIdSet = new Set(ruleIds)
  const byRule = posts.filter((post) => post.ruleIds.some((id) => ruleIdSet.has(id)))
  const byOperator = posts.filter((post) => !byRule.includes(post) && post.operatorTypes.includes(operatorType))
  return [...byRule, ...byOperator].slice(0, MAX_MATCHES)
}
