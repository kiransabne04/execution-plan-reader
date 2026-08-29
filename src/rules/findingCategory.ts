// Episode 13, Story 13.1 — category labels for the "All findings" view's
// category filter. Purely a display concern layered on top of the rule
// engine's own output (ruleId), so it lives next to the rules rather than
// in the graph layer, matching the pattern of Warning.shortText/longText
// being authored once here and consumed by multiple UI surfaces. See
// .claude/skills/rule-engine-authoring/SKILL.md.

import type { Warning } from "../parsers/normalize"
import { ruleFamily } from "./summarize"

export type FindingCategory =
  | "Scan issues"
  | "Index issues"
  | "Join issues"
  | "Estimate issues"
  | "Spill issues"
  | "Loop issues"
  | "General notes"

// One entry per rule family currently in ALL_RULES (src/rules/index.ts).
// Adding a new rule without adding it here isn't a crash — it just falls
// back to "General notes" below — but keep this in sync so filtering stays
// useful rather than dumping new rules into a catch-all bucket.
const RULE_FAMILY_CATEGORY: Record<string, FindingCategory> = {
  "seq-scan-on-large-table": "Scan issues",
  "missing-index-opportunity": "Index issues",
  "exploding-join": "Join issues",
  "bad-row-estimate": "Estimate issues",
  "disk-spill": "Spill issues",
  "high-loop-count": "Loop issues",
  "parameter-sensitivity-honesty-note": "General notes",
  "estimate-only-plan": "General notes",
}

export function categorizeFinding(warning: Warning): FindingCategory {
  return RULE_FAMILY_CATEGORY[ruleFamily(warning.ruleId)] ?? "General notes"
}

/** Episode 18, Story 18.13 — the content stack's own "seen but unmapped"
 * validation (`posts.test.ts`) checks a post's `ruleIds` against this same
 * canonical rule-family list, rather than maintaining a second one. */
export const KNOWN_RULE_FAMILIES: readonly string[] = Object.keys(RULE_FAMILY_CATEGORY)

/** Stable display order for the category filter — roughly execution-path
 * order (scan -> index -> join -> estimate -> spill -> loop), general notes
 * last since they're plan-wide rather than operator-specific. */
export const FINDING_CATEGORY_ORDER: FindingCategory[] = [
  "Scan issues",
  "Index issues",
  "Join issues",
  "Estimate issues",
  "Spill issues",
  "Loop issues",
  "General notes",
]
