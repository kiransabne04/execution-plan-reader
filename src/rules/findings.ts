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

// Story 20.4 — a multi-statement SQL Server batch's Findings panel was
// scoped to whichever ONE statement happened to be active, silently
// hiding every finding on the other statements (including ones sitting
// inside a currently-collapsed control-flow group). This is the
// whole-BATCH equivalent of `collectAllFindings` above.

export interface BatchFinding extends Finding {
  statementIndex: number
  statementLabel: string
}

/** Root-level rules that restate the same PLAN-WIDE fact on every single
 * statement's own root (parameter-sensitivity-honesty-note,
 * estimate-only-plan — see parameterSensitivityNote.ts/estimateOnlyNote.ts)
 * rather than describing something specific to that one statement. Merging
 * findings across ~100+ statements without accounting for this would show
 * the same two sentences ~100+ times — worse noise than the single-
 * statement view this story is fixing, not better. */
const PLAN_WIDE_RULE_IDS = new Set(["parameter-sensitivity-honesty-note", "estimate-only-plan"])

export interface FindingsSource {
  statementIndex: number
  statementLabel: string
  root: PlanNode
}

/**
 * Every finding across every statement in the batch, tagged with which
 * statement it came from — severity-first, with the plan-wide honesty
 * notes deduped to one instance each (first occurrence, i.e. lowest
 * statement index) rather than one per statement. A single-statement
 * batch (`sources.length === 1`, the common case for Postgres/Snowflake
 * and most SQL Server input) behaves identically to `collectAllFindings`
 * — no plan-wide rule ever needs deduping when there's only one root to
 * begin with.
 */
export function collectFindingsAcrossStatements(sources: FindingsSource[]): BatchFinding[] {
  const seenPlanWide = new Set<string>()
  const findings: BatchFinding[] = []
  for (const { statementIndex, statementLabel, root } of sources) {
    for (const finding of collectAllFindings(root)) {
      if (PLAN_WIDE_RULE_IDS.has(finding.warning.ruleId)) {
        if (seenPlanWide.has(finding.warning.ruleId)) continue
        seenPlanWide.add(finding.warning.ruleId)
      }
      findings.push({ ...finding, statementIndex, statementLabel })
    }
  }
  return findings.sort((a, b) => SEVERITY_RANK[a.warning.severity] - SEVERITY_RANK[b.warning.severity])
}
