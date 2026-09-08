// Episode 30, Story 30.3 — groups a Snowflake scan's three co-occurring
// symptoms (poor partition pruning, a large scan volume, and disk-I/O-
// heavy execution) into one root-cause story when they all fire on the
// SAME node, rather than three unrelated-looking findings a reader has to
// mentally connect themselves.
//
// Deliberately a DIFFERENT mechanism from `cardinalityPropagation.ts`'s
// own root-cause grouping (Episode 25, Story 25.7), even though it reuses
// that file's `RootCauseGroup` shape for consistency: `cardinalityPropagation.ts`
// links a cause at one node to an effect at an ANCESTOR further up the
// tree (a bad estimate cascading into a downstream join's blowup). Here,
// all three symptoms are properties of the exact SAME scan operator —
// `pruning`, `io.bytesScanned`, and `timeBreakdown` all live on the same
// `PlanNode` — so this is a same-node co-occurrence check, not an
// ancestor-walk. No new propagation-direction logic is needed because
// there's no propagation: poor pruning, the resulting large scan, and the
// resulting disk-I/O time are three symptoms of one underlying cause on
// one operator.
//
// Same "second pass, after applyRules" discipline as
// `cardinalityPropagation.ts`: reads already-populated `node.warnings`
// (via `collectAllFindings`), never a `Rule` itself. Purely a data-layer
// addition, same as `groupByRootCause`'s own precedent — no UI surface is
// specified by this story; a Findings-panel rendering of
// `RootCauseGroup[]` is a natural follow-up, out of this story's scope.

import { collectAllFindings, type Finding } from "./findings"
import type { RootCauseGroup } from "./cardinalityPropagation"
import type { PlanNode } from "../parsers/normalize"

const PRIMARY_RULE_ID = "poor-partition-pruning"
const CONSEQUENCE_RULE_IDS = ["large-scan-volume", "buffer-cache-inefficiency"]

/**
 * One group per node where ALL THREE symptoms fired together: poor
 * pruning (the primary), plus both a large-scan-volume finding and a
 * disk-I/O-heavy (`buffer-cache-inefficiency`) finding on that exact same
 * node (the consequences). A node with only 1 or 2 of the three never
 * forms a group — this is deliberately conservative: co-occurrence of
 * findings that already independently exist, not a claim that pruning
 * caused the others when the evidence for that specific combination isn't
 * actually all present.
 */
export function groupSnowflakeScanRootCause(root: PlanNode): RootCauseGroup[] {
  const findingsByNode = new Map<string, Finding[]>()
  for (const finding of collectAllFindings(root)) {
    const existing = findingsByNode.get(finding.nodeId)
    if (existing) existing.push(finding)
    else findingsByNode.set(finding.nodeId, [finding])
  }

  const groups: RootCauseGroup[] = []
  for (const nodeFindings of findingsByNode.values()) {
    const primary = nodeFindings.find((f) => f.warning.ruleId === PRIMARY_RULE_ID)
    if (!primary) continue

    const consequences = CONSEQUENCE_RULE_IDS.map((ruleId) => nodeFindings.find((f) => f.warning.ruleId === ruleId)).filter((f): f is Finding => f !== undefined)
    if (consequences.length < CONSEQUENCE_RULE_IDS.length) continue // all three must be present — see this file's own doc comment

    groups.push({ primary, consequences })
  }
  return groups
}
