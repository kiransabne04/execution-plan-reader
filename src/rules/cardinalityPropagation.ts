// Episode 25, Stories 25.1 and 25.7 — cross-node reasoning over findings
// the rule engine has ALREADY produced. This is deliberately NOT a `Rule`
// (`(node, context) => Warning[]`) — a single rule function only ever sees
// one node plus whole-tree scalars; it has no way to reference another
// node's findings, and this file does not change that contract (no rule
// gains a "list of findings so far" argument, which would make rule output
// order-dependent and break the "independently unit-testable,
// deterministic" guarantee `rule-engine-authoring` requires).
//
// Instead, this is a second pass that runs AFTER `collectAllFindings`
// produces its normal per-node `Warning[]` — exactly the same shape
// `summarize.ts`'s own `buildAncestryIndex`/`areRelated` already use for
// its 2-finding case (Episode 5, Story 5.2: "a scan feeding a downstream
// problem on the same subtree"). This file generalizes that existing,
// already-shipped mechanism from "top 2 findings, one hardcoded scan →
// downstream pair" to "every finding, any number of hops, multiple
// related-family pairs" — not a second, differently-shaped relationship
// system.
//
// `causedBy`/`contributesTo` (the story's own requested field names) are
// the two directions of the SAME edge list (`FindingRelationship[]`), not
// two independently-computed relations that could drift out of sync: a
// relationship's `causeNodeId` is the effect's `causedBy`, and the same
// relationship is the cause's `contributesTo`. `Warning` itself is never
// mutated — its text stays authored once, per-node, exactly as today; the
// relationship is a separate lookup a UI can join against it.

import { collectNodes, type PlanNode } from "../parsers/normalize"
import { collectAllFindings, type Finding } from "./findings"
import { buildAncestryIndex, ruleFamily } from "./summarize"

/** A descendant's bad estimate is the only currently-known propagation
 * SOURCE — the family that can genuinely distort a plan shape further up
 * the tree (join algorithm selection, memory sizing) in a way this app can
 * actually observe as a distinct downstream symptom. Not every finding
 * family is a plausible propagation cause; over-connecting unrelated
 * findings into one false narrative is exactly the failure mode this list
 * exists to prevent. */
const CAUSE_FAMILIES = new Set(["bad-row-estimate"])

/** Downstream symptoms a bad estimate can plausibly explain. */
const EFFECT_FAMILIES = new Set(["exploding-join", "high-loop-count", "nested-loop-explosion"])

const SEVERITY_RANK: Record<Finding["warning"]["severity"], number> = { critical: 0, warning: 1, info: 2 }

export interface FindingRelationship {
  causeNodeId: string
  causeFamily: string
  effectNodeId: string
  effectFamily: string
  /** Tree-edge distance between cause and effect (1 = direct parent/child). */
  hops: number
}

interface FamilyFinding {
  nodeId: string
  family: string
  finding: Finding
}

function withFamily(findings: Finding[]): FamilyFinding[] {
  return findings.map((f) => ({ nodeId: f.nodeId, family: ruleFamily(f.warning.ruleId), finding: f }))
}

/**
 * Every plausible cardinality-error → downstream-symptom relationship in
 * this tree, one edge per effect finding (an effect with multiple
 * qualifying ancestor causes keeps only its single BEST cause — worst
 * severity first, closest hop count as the tiebreak — so a family
 * appearing on several nodes along one chain still produces one clean
 * edge per effect, not a combinatorial fan-out). A cause node can still
 * feed MULTIPLE different effects further up a branching or multi-level
 * tree (the story's own 3-level scan → nested loop → aggregate example) —
 * that's multiple distinct effect entries, not a conflict.
 */
export function linkPropagatedFindings(root: PlanNode): FindingRelationship[] {
  const findings = withFamily(collectAllFindings(root))
  const causes = findings.filter((f) => CAUSE_FAMILIES.has(f.family))
  const effects = findings.filter((f) => EFFECT_FAMILIES.has(f.family))
  if (causes.length === 0 || effects.length === 0) return []

  const ancestry = buildAncestryIndex(root)
  const relationships: FindingRelationship[] = []

  for (const effect of effects) {
    const effectDepth = ancestry.get(effect.nodeId)?.size
    if (effectDepth === undefined) continue

    let best: { cause: FamilyFinding; hops: number } | undefined
    for (const cause of causes) {
      if (cause.nodeId === effect.nodeId) continue // a node doesn't cause its own symptom
      // Propagation flows UP the tree: the cause fired at a DESCENDANT
      // (executes first, deeper in the plan), the effect appears at an
      // ANCESTOR further up. So the cause's own ancestor set must contain
      // the effect's node id — NOT the other way around.
      const causeAncestors = ancestry.get(cause.nodeId)
      if (!causeAncestors?.has(effect.nodeId)) continue

      const hops = causeAncestors.size - effectDepth
      const causeSeverity = SEVERITY_RANK[cause.finding.warning.severity]
      const bestSeverity = best ? SEVERITY_RANK[best.cause.finding.warning.severity] : Number.POSITIVE_INFINITY
      if (!best || causeSeverity < bestSeverity || (causeSeverity === bestSeverity && hops < best.hops)) {
        best = { cause, hops }
      }
    }

    if (best) {
      relationships.push({
        causeNodeId: best.cause.nodeId,
        causeFamily: best.cause.family,
        effectNodeId: effect.nodeId,
        effectFamily: effect.family,
        hops: best.hops,
      })
    }
  }

  return relationships
}

export interface RootCauseGroup {
  /** The finding with no known cause of its own but at least one downstream
   * consequence — e.g. the leaf scan's bad-row-estimate. */
  primary: Finding
  /** Everything the primary transitively contributes to, deduped by family
   * (an equivalent recommendation never appears twice across a group). */
  consequences: Finding[]
}

/**
 * Groups propagated findings into primary-cause + consequences, the
 * story's own "Primary: cardinality estimate 12,000× too low / Consequences:
 * nested loop selected, inner node executed 620k times, buffer reads
 * increased" shape. Purely a data-layer transform — no UI surface is
 * specified by this story; a Findings-panel or summary rendering of
 * `RootCauseGroup[]` is a natural follow-up, out of this story's own
 * scope (the same "named explicitly, not silently assumed" disclosure
 * Episode 24 used for its own `buildStatRows.ts` follow-up).
 */
export function groupByRootCause(root: PlanNode): RootCauseGroup[] {
  const relationships = linkPropagatedFindings(root)
  if (relationships.length === 0) return []

  const findingsByKey = new Map<string, Finding>()
  for (const finding of collectAllFindings(root)) {
    findingsByKey.set(`${finding.nodeId}:${ruleFamily(finding.warning.ruleId)}`, finding)
  }

  const groups = new Map<string, RootCauseGroup>()
  for (const rel of relationships) {
    const causeKey = `${rel.causeNodeId}:${rel.causeFamily}`
    const effectKey = `${rel.effectNodeId}:${rel.effectFamily}`
    const primary = findingsByKey.get(causeKey)
    const consequence = findingsByKey.get(effectKey)
    if (!primary || !consequence) continue // should always resolve — defensive, never throws on a lookup miss

    let group = groups.get(causeKey)
    if (!group) {
      group = { primary, consequences: [] }
      groups.set(causeKey, group)
    }
    group.consequences.push(consequence)
  }

  // Dedup consequences by family within each group — the story's own
  // "do not duplicate equivalent recommendations" instruction.
  for (const group of groups.values()) {
    const seenFamilies = new Set<string>()
    group.consequences = group.consequences.filter((c) => {
      const family = ruleFamily(c.warning.ruleId)
      if (seenFamilies.has(family)) return false
      seenFamilies.add(family)
      return true
    })
  }

  return [...groups.values()]
}

// Re-exported so a UI or test consuming this module doesn't also need a
// direct import of normalize.ts just to walk the tree alongside these
// results (e.g. resolving a nodeId back to its PlanNode for display).
export { collectNodes }
