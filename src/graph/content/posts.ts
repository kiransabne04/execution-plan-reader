// Episode 18, Story 18.13, spec §5 `2c`. **Deliberately zero entries** —
// "Titles in the mockup are placeholders. Do not ship invented links;
// render the stack only once posts.ts has real entries." Same rule this
// project already applies elsewhere (Episode 12.1: "do not fabricate
// placeholder links claiming to be real content"). ContentStack.tsx is
// fully built and tested against a SYNTHETIC fixture
// (__tests__/matchContentPosts.test.ts) — this file's emptiness blocks
// only the CONTENT, not the component, matching the same real-URL
// blocker Episode 12.1 already tracks.
//
// **Location deviation from the spec's literal path**: spec §5 `2c` names
// `app/content/ContentStack.tsx`, but this feature is used exclusively by
// `DetailPanel.tsx` (`src/graph/detailPanel/`) — placing it under
// `src/app/` would mean a `src/graph` file importing FROM `src/app`,
// backwards from this codebase's established layering (`src/app` is the
// top-level composing layer that imports FROM `src/graph`, never the
// reverse — the exact same reasoning Story 18.10's canvas-mode banner
// already applied to avoid importing `src/app/Notice.tsx` into
// `src/graph/PlanGraph.tsx`). Kept under `src/graph/content/` instead —
// a deliberate, documented deviation from the literal spec path, not a
// silent one.

export interface ContentPost {
  id: string
  kind: "blog" | "video"
  title: string
  url: string
  minutes: number
  /** Matches against the open node's `operatorType` (plan-normalization
   * skill's normalized taxonomy). */
  operatorTypes: string[]
  /** Matches against a `Warning.ruleId` fired on the open node. */
  ruleIds: string[]
}

export const POSTS: ContentPost[] = []
