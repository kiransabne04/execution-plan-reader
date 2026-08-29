// Episode 18, Story 18.8 — pure search/filter logic over a PlanNode tree,
// deliberately framework-light (same "no React, no DOM" discipline
// buildGraphElements.ts follows) so it's independently testable without
// mounting the palette UI. See docs/12-ui-redesign-spec.md §5 `1h`.

import { collectNodes, type PlanNode, type Warning } from "../../parsers/normalize"
import { relationIdentity, indexIdentity } from "../../parsers/relationIdentity"

export type SeverityFilter = "all" | Warning["severity"]

/** Every field spec §5 `1h` names: "rawOperatorLabel, relationName,
 * index.name and warning severity" — relation/index identity reuses the
 * exact same per-engine `attributes` reading Episode 14's node-matching
 * algorithm and Story 18.4's node subtitle already solved, not a third
 * re-derivation. Severity words are included so typing "critical" finds
 * every critical-severity node, matching the filter chips' own vocabulary. */
function buildSearchableText(node: PlanNode): string {
  const parts = [node.rawOperatorLabel, relationIdentity(node), indexIdentity(node), ...node.warnings.map((w) => w.severity)]
  return parts.filter((p): p is string => p !== undefined).join(" ").toLowerCase()
}

/** A node matches the SEVERITY filter when it carries at least one warning
 * at that exact severity — "all" always matches. */
function matchesSeverity(node: PlanNode, severityFilter: SeverityFilter): boolean {
  if (severityFilter === "all") return true
  return node.warnings.some((w) => w.severity === severityFilter)
}

export interface SearchResult {
  /** Whether ANY search/filter is currently active — distinct from
   * `matchedIds.size === 0`, since "no query yet" and "query matched
   * nothing" need different UI treatment (the palette shows all nodes vs.
   * an explicit "no matches" state — see SearchPalette.tsx). */
  isActive: boolean
  matchedIds: Set<string>
  /** The matched nodes themselves, in tree order — what the palette's
   * results list actually renders. */
  matches: PlanNode[]
}

/**
 * Story 18.8: an empty query AND `severityFilter === "all"` together mean
 * "no active search" — every node matches, `isActive` is false (the
 * palette shows the full node list, unfiltered, not a coincidentally-
 * complete "match"). Query matching is a case-insensitive substring test,
 * same as `FindingsList.tsx`'s own filter selects use for their equality
 * checks — deliberately simple, no fuzzy-matching library, consistent
 * with this app's "no unnecessary dependency" bar.
 */
export function searchNodes(root: PlanNode, query: string, severityFilter: SeverityFilter): SearchResult {
  const trimmedQuery = query.trim().toLowerCase()
  const isActive = trimmedQuery.length > 0 || severityFilter !== "all"

  const allNodes = collectNodes(root)
  const matches = allNodes.filter((node) => {
    const textMatches = trimmedQuery.length === 0 || buildSearchableText(node).includes(trimmedQuery)
    return textMatches && matchesSeverity(node, severityFilter)
  })

  return { isActive, matchedIds: new Set(matches.map((n) => n.id)), matches }
}
