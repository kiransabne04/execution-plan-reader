import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"
import { badRowEstimate } from "./badRowEstimate"
import { diskSpill } from "./diskSpill"
import { estimateOnlyNote } from "./estimateOnlyNote"
import { explodingJoin } from "./explodingJoin"
import { highLoopCount } from "./highLoopCount"
import { missingIndexOpportunity } from "./missingIndexOpportunity"
import { parameterSensitivityNote } from "./parameterSensitivityNote"
import { seqScanOnLargeTable } from "./seqScanOnLargeTable"
import type { PlanContext, Rule } from "./types"

export * from "./types"
export { seqScanOnLargeTable } from "./seqScanOnLargeTable"
export { badRowEstimate } from "./badRowEstimate"
export { diskSpill } from "./diskSpill"
export { highLoopCount } from "./highLoopCount"
export { explodingJoin } from "./explodingJoin"
export { missingIndexOpportunity } from "./missingIndexOpportunity"
export { parameterSensitivityNote } from "./parameterSensitivityNote"
export { estimateOnlyNote } from "./estimateOnlyNote"
export { summarizePlan, type PlanSummary, type SummarySeverity, NO_ISSUES_TEXT } from "./summarize"
export { collectAllFindings, type Finding } from "./findings"
export { categorizeFinding, FINDING_CATEGORY_ORDER, type FindingCategory } from "./findingCategory"

export const ALL_RULES: Rule[] = [
  diskSpill,
  explodingJoin,
  seqScanOnLargeTable,
  badRowEstimate,
  highLoopCount,
  missingIndexOpportunity,
  parameterSensitivityNote,
  estimateOnlyNote,
]

const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }

/**
 * Evaluates every registered rule against every node in the tree and
 * populates each node's `warnings` (mutates in place — PlanNode.warnings
 * starts empty from the parser by design; this is where it gets filled).
 * Returns the same root for convenience/chaining.
 *
 * Warnings are sorted by severity but never truncated here — capping how
 * many are *shown* by default is a display concern for the graph/UI layer,
 * not something the rule engine should decide by discarding data.
 */
export function applyRules(root: PlanNode, context: PlanContext): PlanNode {
  for (const node of collectNodes(root)) {
    const warnings = ALL_RULES.flatMap((rule) => rule(node, context))
    warnings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    node.warnings = warnings
  }
  return root
}
