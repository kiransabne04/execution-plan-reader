// Episode 13, Story 13.1 — the complete, unfiltered findings list. This is
// deliberately a different data source from summarize.ts's synthesis: no
// per-family dedup, no cap. If a rule fired 12 times across 12 nodes, all
// 12 appear here — summarize.ts's "top 1-3 for the paragraph" behavior is
// a separate, additive concern for beginner orientation, not something this
// module reproduces. See .claude/skills/rule-engine-authoring/SKILL.md and
// the "Correction to Story 5.1's edge-case table" note in
// docs/08-episodes-and-stories.md's Episode 13.

import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"
import { categorizeFinding, type FindingCategory } from "./findingCategory"

export interface Finding {
  nodeId: string
  warning: Warning
  category: FindingCategory
}

const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }

/** Every `Warning` produced by the rule engine across the whole tree,
 * severity-first (stable sort — ties keep tree-traversal/rule order, so
 * output is deterministic across calls on the same tree). */
export function collectAllFindings(root: PlanNode): Finding[] {
  const findings = collectNodes(root).flatMap((node) =>
    node.warnings.map((warning): Finding => ({ nodeId: node.id, warning, category: categorizeFinding(warning) })),
  )
  return findings.sort((a, b) => SEVERITY_RANK[a.warning.severity] - SEVERITY_RANK[b.warning.severity])
}
