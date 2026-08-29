// Episode 14 Story 14.1 — match nodes between two plans of the same query
// (or two versions of a similar query) so a comparison view can say "this
// node in Plan A corresponds to this node in Plan B" instead of showing two
// unrelated trees side by side. See docs/08-episodes-and-stories.md Episode
// 14 for the full spec this file implements.
//
// This module reads `PlanNode` trees only — it does no parsing and adds no
// network calls, consistent with the privacy-architecture skill.

import type { Engine, PlanNode } from "../parsers/normalize"
import { relationIdentity, indexIdentity } from "../parsers/relationIdentity"

export type NodeMatchStatus = "matched" | "changed" | "addedInB" | "removedFromB"

export interface NodeMatch {
  status: NodeMatchStatus
  /** Present for every status except `addedInB`. */
  nodeIdA?: string
  /** Present for every status except `removedFromB`. */
  nodeIdB?: string
}

export type PlanComparisonErrorCode = "CROSS_ENGINE"

/** Mirrors `PlanParseError`'s shape (src/parsers/normalize.ts) so callers can
 * handle both the same way: a typed `code` plus a message safe to show
 * as-is (never includes raw pasted plan content). */
export class PlanComparisonError extends Error {
  readonly code: PlanComparisonErrorCode

  constructor(code: PlanComparisonErrorCode, message: string) {
    super(message)
    this.name = "PlanComparisonError"
    this.code = code
  }
}

// relationIdentity/indexIdentity moved to src/parsers/relationIdentity.ts in
// Episode 18 Story 18.4, once the graph layer (node subtitles) needed the
// exact same per-engine reading this module first solved — re-exported here
// so every existing import of these two names from this file still works.
export { relationIdentity, indexIdentity }

/**
 * A node's identity for matching purposes: relation name when present,
 * otherwise index name, otherwise `undefined` (e.g. a `Sort` or
 * `Aggregate` — Story 14.1's "positional-only fallback" case).
 *
 * Relation wins over index deliberately: "an index was added" is exactly
 * the scenario where the index identity *changes* (absent -> present)
 * while the relation stays constant — keying on the pair together would
 * make that node fail to match on identity at all, defeating the point of
 * the relaxed phase. A standalone index-only node (Postgres's `Bitmap
 * Index Scan`, whose `Relation Name` lives on its parent `Bitmap Heap
 * Scan`) falls back to its index name instead.
 */
function nodeIdentity(node: PlanNode): string | undefined {
  const relation = relationIdentity(node)
  if (relation !== undefined) return `relation:${relation}`
  const index = indexIdentity(node)
  if (index !== undefined) return `index:${index}`
  return undefined
}

interface NodePosition {
  node: PlanNode
  depth: number
  ordinal: number // position among this node's siblings
}

/**
 * Depth + ordinal-among-siblings for every node, computed once per tree.
 * Snowflake nodes can have more than one parent (see `buildTree.ts`'s
 * module comment); this walk keeps the first-encountered position for such
 * a node, same as `collectNodes`'s dedup — a deliberate simplification
 * (one position, not a set of positions) rather than something silently
 * wrong: a shared node's *other* incoming edges just don't get a distinct
 * positional identity of their own.
 */
function computePositions(root: PlanNode): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>()
  const walk = (node: PlanNode, depth: number, ordinal: number) => {
    if (positions.has(node.id)) return
    positions.set(node.id, { node, depth, ordinal })
    node.children.forEach((child, i) => walk(child, depth + 1, i))
  }
  walk(root, 0, 0)
  return positions
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/**
 * Matches nodes between two plans of the same engine, using a layered
 * strategy that falls back progressively (Story 14.1's acceptance
 * criteria). Every phase is a hash-map grouping + lookup, not a nested
 * scan, so the whole function is O(n+m) rather than O(n·m) even on large
 * (100+ node) plans.
 *
 * 1. Exact signature: operator type + relation/index identity + structural
 *    position (depth, ordinal-among-siblings) all agree -> `matched`.
 * 2. Relaxed: same relation/index identity, position ignored -> `matched`
 *    if the operator type also still agrees (e.g. join order shifted a
 *    scan's position but not its identity or algorithm), else `changed`
 *    (e.g. an index was added and a seq scan became an index scan).
 * 3. Positional-only fallback, for nodes with no relation/index identity at
 *    all (a bare `Sort`/`Aggregate`): same depth + ordinal -> `matched` if
 *    operator type agrees, else `changed`.
 * 4. Whatever's left is genuinely unmatched: present only in A ->
 *    `removedFromB`, present only in B -> `addedInB`.
 *
 * Candidates that share a phase-2/3 key are paired in tree-traversal order
 * (not a globally-optimal assignment) — good enough given the layered
 * cascade above already resolves the common cases precisely; a self-join
 * touching the same table/index twice is the case where this ordering
 * choice matters most, and traversal order is a reasonable, deterministic
 * tie-break for it.
 */
export function matchNodes(planA: PlanNode, planB: PlanNode): NodeMatch[] {
  if (planA.engine !== planB.engine) {
    throw new PlanComparisonError(
      "CROSS_ENGINE",
      `Cannot compare a ${engineLabel(planA.engine)} plan with a ${engineLabel(planB.engine)} plan — these plans are from different database engines and can't be directly compared.`,
    )
  }

  const positionsA = [...computePositions(planA).values()]
  const positionsB = [...computePositions(planB).values()]

  const matchedA = new Set<string>()
  const matchedB = new Set<string>()
  const matches: NodeMatch[] = []

  const record = (a: PlanNode | undefined, b: PlanNode | undefined, status: NodeMatchStatus) => {
    if (a) matchedA.add(a.id)
    if (b) matchedB.add(b.id)
    matches.push({ status, nodeIdA: a?.id, nodeIdB: b?.id })
  }

  // Phase 1 — exact signature.
  const exactKey = (p: NodePosition) => `${p.node.operatorType}::${nodeIdentity(p.node) ?? ""}::${p.depth}::${p.ordinal}`
  const exactCandidatesB = groupBy(positionsB, exactKey)
  for (const a of positionsA) {
    const candidates = exactCandidatesB.get(exactKey(a))
    const b = candidates?.shift()
    if (b) record(a.node, b.node, "matched")
  }

  // Phase 2 — relaxed match on relation/index identity alone.
  const identityKey = (p: NodePosition) => nodeIdentity(p.node)
  const identityCandidatesB = groupBy(
    positionsB.filter((p) => !matchedB.has(p.node.id) && identityKey(p) !== undefined),
    (p) => identityKey(p)!,
  )
  for (const a of positionsA) {
    if (matchedA.has(a.node.id)) continue
    const key = identityKey(a)
    if (key === undefined) continue
    const candidates = identityCandidatesB.get(key)
    const b = candidates?.shift()
    if (b) record(a.node, b.node, a.node.operatorType === b.node.operatorType ? "matched" : "changed")
  }

  // Phase 3 — positional-only fallback for nodes with no identity at all.
  const posKey = (p: NodePosition) => `${p.depth}::${p.ordinal}`
  const posCandidatesB = groupBy(
    positionsB.filter((p) => !matchedB.has(p.node.id)),
    posKey,
  )
  for (const a of positionsA) {
    if (matchedA.has(a.node.id)) continue
    const candidates = posCandidatesB.get(posKey(a))
    const b = candidates?.shift()
    if (b) record(a.node, b.node, a.node.operatorType === b.node.operatorType ? "matched" : "changed")
  }

  // Phase 4 — genuinely unmatched.
  for (const a of positionsA) if (!matchedA.has(a.node.id)) record(a.node, undefined, "removedFromB")
  for (const b of positionsB) if (!matchedB.has(b.node.id)) record(undefined, b.node, "addedInB")

  return matches
}

function engineLabel(engine: Engine): string {
  switch (engine) {
    case "postgres":
      return "Postgres"
    case "sqlserver":
      return "SQL Server"
    case "snowflake":
      return "Snowflake"
  }
}

export interface ComparisonSummary {
  matchedCount: number
  changedCount: number
  addedCount: number
  removedCount: number
  /** (matched + changed) / larger side's total node count. */
  matchRatio: number
  /** True when `matchRatio` falls below a sensible confidence floor — the
   * UI (Story 14.2) should surface a warning that these may not be
   * comparable plans, rather than presenting a low-confidence diff as
   * reliable (Story 14.1's "genuinely different queries" edge case). */
  lowConfidence: boolean
}

/** Below this fraction of matched-or-changed nodes, warn the comparison may
 * not be meaningful rather than presenting it as a reliable diff. Chosen as
 * a clear majority-required floor, not tuned against real comparison data
 * yet — revisit once Story 14.2 sees real usage, same spirit as Episode
 * 15's not-yet-benchmarked canvas threshold. */
const LOW_CONFIDENCE_MATCH_RATIO_THRESHOLD = 0.5

export function summarizeMatches(matches: NodeMatch[]): ComparisonSummary {
  let matchedCount = 0
  let changedCount = 0
  let addedCount = 0
  let removedCount = 0
  for (const match of matches) {
    switch (match.status) {
      case "matched":
        matchedCount++
        break
      case "changed":
        changedCount++
        break
      case "addedInB":
        addedCount++
        break
      case "removedFromB":
        removedCount++
        break
    }
  }
  const totalA = matchedCount + changedCount + removedCount
  const totalB = matchedCount + changedCount + addedCount
  const larger = Math.max(totalA, totalB)
  const matchRatio = larger === 0 ? 1 : (matchedCount + changedCount) / larger
  return {
    matchedCount,
    changedCount,
    addedCount,
    removedCount,
    matchRatio,
    lowConfidence: matchRatio < LOW_CONFIDENCE_MATCH_RATIO_THRESHOLD,
  }
}

// nodeIdentity (relation-or-index, matchNodes' own combined key) exported
// for Story 14.2 and tests; relationIdentity/indexIdentity are already
// re-exported near the top of this file.
export { nodeIdentity }
