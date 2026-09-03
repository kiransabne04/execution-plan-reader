import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"
import { badRowEstimate } from "./badRowEstimate"
import { bufferCacheInefficiency } from "./bufferCacheInefficiency"
import { diskSpill } from "./diskSpill"
import { estimateOnlyNote } from "./estimateOnlyNote"
import { explodingJoin } from "./explodingJoin"
import { filterRowsDiscarded } from "./filterRowsDiscarded"
import { hashBatching } from "./hashBatching"
import { highLoopCount } from "./highLoopCount"
import { indexOnlyHeapFetches } from "./indexOnlyHeapFetches"
import { jitOverhead } from "./jitOverhead"
import { joinFilterRowsDiscarded } from "./joinFilterRowsDiscarded"
import { materializeRepeated } from "./materializeRepeated"
import { memoizeEffectiveness } from "./memoizeEffectiveness"
import { missingIndexOpportunity } from "./missingIndexOpportunity"
import { nonSargablePredicate } from "./nonSargablePredicate"
import { parallelWorkerShortfall } from "./parallelWorkerShortfall"
import { parameterSensitivityNote } from "./parameterSensitivityNote"
import { partitionFanout } from "./partitionFanout"
import { pgNestedLoopExplosion } from "./pgNestedLoopExplosion"
import { planningOverhead } from "./planningOverhead"
import { seqScanOnLargeTable } from "./seqScanOnLargeTable"
import { sortDiskSpill } from "./sortDiskSpill"
import { temporaryIo } from "./temporaryIo"
import { walVolume } from "./walVolume"
import type { PlanContext, Rule } from "./types"

export * from "./types"
export { seqScanOnLargeTable } from "./seqScanOnLargeTable"
export { badRowEstimate } from "./badRowEstimate"
export { bufferCacheInefficiency } from "./bufferCacheInefficiency"
export { diskSpill } from "./diskSpill"
export { highLoopCount } from "./highLoopCount"
export { explodingJoin } from "./explodingJoin"
export { missingIndexOpportunity } from "./missingIndexOpportunity"
export { nonSargablePredicate } from "./nonSargablePredicate"
export { parallelWorkerShortfall, parallelShortfallSeverity } from "./parallelWorkerShortfall"
export { parameterSensitivityNote } from "./parameterSensitivityNote"
export { estimateOnlyNote } from "./estimateOnlyNote"
// Episode 24 — Postgres advanced rules.
export { indexOnlyHeapFetches } from "./indexOnlyHeapFetches"
export { filterRowsDiscarded } from "./filterRowsDiscarded"
export { joinFilterRowsDiscarded } from "./joinFilterRowsDiscarded"
export { hashBatching } from "./hashBatching"
export { sortDiskSpill } from "./sortDiskSpill"
export { temporaryIo } from "./temporaryIo"
export { planningOverhead } from "./planningOverhead"
export { jitOverhead } from "./jitOverhead"
export { materializeRepeated } from "./materializeRepeated"
export { memoizeEffectiveness } from "./memoizeEffectiveness"
export { partitionFanout } from "./partitionFanout"
export { walVolume } from "./walVolume"
// Episode 25 — Postgres cross-node reasoning.
export { pgNestedLoopExplosion } from "./pgNestedLoopExplosion"
export { linkPropagatedFindings, groupByRootCause, type FindingRelationship, type RootCauseGroup } from "./cardinalityPropagation"
export { severityForEstimateError } from "./badRowEstimate"
export { summarizePlan, type PlanSummary, type SummarySeverity, NO_ISSUES_TEXT } from "./summarize"
export { collectAllFindings, type Finding } from "./findings"
export { categorizeFinding, FINDING_CATEGORY_ORDER, type FindingCategory } from "./findingCategory"
export {
  computeQueryHealth,
  QUERY_HEALTH_DIMENSIONS,
  CRITICAL_PENALTY,
  WARNING_PENALTY,
  type QueryHealth,
  type QueryHealthDimension,
  type DimensionResult,
  type DimensionScored,
  type DimensionInsufficientData,
} from "./queryHealth"

export const ALL_RULES: Rule[] = [
  diskSpill,
  explodingJoin,
  seqScanOnLargeTable,
  badRowEstimate,
  highLoopCount,
  missingIndexOpportunity,
  nonSargablePredicate,
  bufferCacheInefficiency,
  parallelWorkerShortfall,
  // Episode 24 — Postgres advanced rules.
  indexOnlyHeapFetches,
  filterRowsDiscarded,
  joinFilterRowsDiscarded,
  hashBatching,
  sortDiskSpill,
  temporaryIo,
  planningOverhead,
  jitOverhead,
  materializeRepeated,
  memoizeEffectiveness,
  partitionFanout,
  walVolume,
  // Episode 25 — Postgres cross-node reasoning.
  pgNestedLoopExplosion,
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
