// Episode 23, Story 23.1 — a single deterministic, explainable "Query
// Health" score (an overall number plus 5 per-dimension subscores), built
// entirely from the rule engine's own already-computed `Warning[]` output.
// No LLM, no network call — pure math over data this app already has. See
// docs/08-episodes-and-stories.md Episode 23 for the full design rationale,
// especially why a dimension without enough data returns
// `{ status: "insufficient-data" }` rather than a fabricated number: this
// codebase's own parameter-sensitivity honesty rule
// (parameterSensitivityNote.ts) exists specifically because a single pasted
// plan is one snapshot of one execution, and a clean composite score is
// exactly the kind of confident-sounding output that principle warns
// against — the eligibility gates below are as much a part of this spec as
// the scoring math itself, not a defensive afterthought.

import { collectNodes, type PlanNode } from "../parsers/normalize"
import type { PlanContext } from "./types"
import { collectAllFindings } from "./findings"
import { dedupeByFamily, ruleFamily, type Finding } from "./summarize"

export type QueryHealthDimension = "runtime" | "cardinality" | "memory" | "io" | "parallelism"

export const QUERY_HEALTH_DIMENSIONS: readonly QueryHealthDimension[] = [
  "runtime",
  "cardinality",
  "memory",
  "io",
  "parallelism",
]

export interface DimensionScored {
  status: "scored"
  score: number // 0-100, integer
}

export interface DimensionInsufficientData {
  status: "insufficient-data"
}

export type DimensionResult = DimensionScored | DimensionInsufficientData

export interface QueryHealth {
  overall: DimensionResult
  dimensions: Record<QueryHealthDimension, DimensionResult>
  /** Node-scoped, not finding-scoped — see this file's own `countNodesBySeverity`
   * doc comment for the exact definition. `critical + warning + healthy` is
   * always exactly `context.nodeCount`. */
  critical: number
  warning: number
  healthy: number
}

/** A first defensible default, deliberately simple — NOT derived from
 * calibration against a corpus of real plans. Flagged explicitly as a
 * number to revisit once real usage exists, the same honesty this codebase
 * already applies to `CANVAS_NODE_COUNT_THRESHOLD`'s own "not yet
 * benchmarked" note (`PlanGraph.tsx`). An `info`-severity finding never
 * penalizes (no defect rule currently emits `info` — the two honesty-note
 * rules are excluded entirely below, not merely zero-penalized). */
// Exported so QueryHealthCard's own "how this is calculated" disclosure
// (Story 23.3) can be tested against these exact numbers directly, rather
// than the UI's prose text silently drifting out of sync with the real
// formula over time.
export const CRITICAL_PENALTY = 30
export const WARNING_PENALTY = 12

// Disclosure notes about the plan's own nature (parameter sensitivity,
// estimate-only), never defects — excluded from scoring entirely, not
// merely zero-penalized (a future info-severity DEFECT rule must still
// count; see this file's own test for that exact distinction).
const EXCLUDED_RULE_IDS = new Set(["parameter-sensitivity-honesty-note", "estimate-only-plan"])

// Episode 23's own dimension table (docs/08-episodes-and-stories.md) is the
// actual spec for this mapping — update that table first if this ever
// changes, per STORY_TEMPLATE.md rule 4. Episode 24's own 12 new rule
// families are mapped here too (see that episode's own doc for the
// reasoning) — leaving a new rule family unmapped would silently let
// Query Health ignore it forever, which is its own honesty violation:
// a plan could carry a critical Episode 24 finding and still show a
// misleadingly clean score. A handful of the new families are info-only
// (never critical/warning) and so never actually move the score even
// once mapped — mapped anyway, for the same reason the two honesty-note
// rules are explicitly EXCLUDED rather than just silently zero-penalty:
// consistency should be a stated decision, not an accident of which
// rules happen to emit which severities today.
const DIMENSION_RULE_FAMILIES: Record<QueryHealthDimension, string[]> = {
  runtime: [
    "seq-scan-on-large-table",
    "high-loop-count",
    "index-only-heap-fetches",
    "planning-overhead",
    "jit-overhead",
    "materialize-repeated",
    "memoize-low-hit-rate",
    // Episode 25 — Postgres-specific nested-loop pattern, same dimension
    // as the generic high-loop-count it specializes.
    "nested-loop-explosion",
  ],
  cardinality: [
    "bad-row-estimate",
    "exploding-join",
    "missing-index-opportunity",
    "non-sargable-predicate",
    "filter-rows-discarded",
    "join-filter-rows-discarded",
    "partition-fanout",
  ],
  memory: ["disk-spill", "hash-batching", "sort-disk", "sort-large", "temp-io", "memoize-evictions"],
  io: ["buffer-cache-inefficiency", "wal-volume"],
  // Story 23.2 adds the parallel-worker-shortfall rule that actually feeds
  // this family; the mapping is declared here already so Story 23.2 only
  // has to add the rule + extend `isDimensionEligible` below, not touch
  // this table.
  parallelism: ["parallel-worker-shortfall"],
}

/** Whether a dimension has ANY data to score at all — checked against the
 * same fields the underlying rules themselves read, before rules even run,
 * so this never has to guess from the ABSENCE of a finding whether that
 * means "checked, found nothing" or "couldn't check." See the dimension
 * table in docs/08-episodes-and-stories.md Episode 23 for the reasoning
 * behind each gate. */
function isDimensionEligible(dimension: QueryHealthDimension, nodes: PlanNode[], context: PlanContext): boolean {
  switch (dimension) {
    case "runtime":
      // Both rule families' real signal is about ACTUAL execution behavior
      // (a loop count only exists once a plan has actually run; a scan's
      // cost only means "runtime" once wall-clock time backs it) — an
      // estimate-only plan has no loops field at all.
      return context.hasActualData
    case "cardinality":
      return nodes.some((n) => n.estimatedRows !== undefined)
    case "memory":
      // The parser attempted spill detection for this node at all
      // (`SpillInfo` present), regardless of whether it actually spilled.
      return nodes.some((n) => n.spill !== undefined)
    case "io":
      return nodes.some(
        (n) => n.io?.bufferHits !== undefined || n.io?.bufferReads !== undefined || n.timeBreakdown?.localDiskIoPercentage !== undefined || n.timeBreakdown?.remoteDiskIoPercentage !== undefined,
      )
    case "parallelism":
      // Postgres: per-node, both fields genuinely populated
      // (extendedFields.ts). SQL Server: query-level — real per-node
      // thread-count data must exist (hasActualData) alongside a real
      // compiled DOP figure (Story 23.2's own new context field), the
      // exact same gate `parallelWorkerShortfall.ts`'s own SQL Server
      // check uses, not a second, differently-worded copy of it. Snowflake
      // has no signal to add here at all (Episode 23's own dimension
      // table — a permanent, checked ceiling, not a gap).
      return (
        nodes.some((n) => n.parallel?.workersPlanned !== undefined && n.parallel?.workersLaunched !== undefined) ||
        (context.hasActualData && context.compiledDegreeOfParallelism !== undefined && context.compiledDegreeOfParallelism > 1)
      )
  }
}

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Worst-instance-per-family penalty sum for one dimension's findings —
 * reuses `dedupeByFamily` (summarize.ts) so a rule that fired on 40
 * different nodes still costs exactly one family's penalty, the same
 * "one theme, one accounting" the top-level summary sentence already
 * applies, not something scored a second, differently way here. */
function scoreEligibleDimension(familyFindings: Finding[]): DimensionScored {
  const worstPerFamily = dedupeByFamily(familyFindings)
  const penalty = worstPerFamily.reduce((sum, finding) => {
    if (finding.warning.severity === "critical") return sum + CRITICAL_PENALTY
    if (finding.warning.severity === "warning") return sum + WARNING_PENALTY
    return sum
  }, 0)
  return { status: "scored", score: clamp0to100(100 - penalty) }
}

/** Node-scoped severity counts for the 🔴/🟠/🟢 legend — deliberately NOT
 * finding-scoped (a node carrying 3 critical warnings still counts once).
 * A node already counted critical is never also counted warning.
 * `critical + warning + healthy` always equals `nodes.length` exactly. */
function countNodesBySeverity(nodes: PlanNode[]): Pick<QueryHealth, "critical" | "warning" | "healthy"> {
  let critical = 0
  let warning = 0
  let healthy = 0
  for (const node of nodes) {
    if (node.warnings.some((w) => w.severity === "critical")) critical++
    else if (node.warnings.some((w) => w.severity === "warning")) warning++
    else healthy++
  }
  return { critical, warning, healthy }
}

/**
 * Computes the Query Health score for ONE statement's tree. Requires rules
 * to have already run (`applyRules`/`analyzePlan.ts`) — this function reads
 * `node.warnings`, it never runs rules itself, mirroring `summarizePlan`'s
 * own contract. Scoped per-statement, same as `summarizePlan` and
 * `PlanContext` themselves — call fresh on every active-statement change in
 * a multi-statement batch, never cached across statements (Story 20.5's own
 * header-notices bug is the cautionary precedent for getting this wrong).
 */
export function computeQueryHealth(root: PlanNode, context: PlanContext): QueryHealth {
  const nodes = collectNodes(root)
  const allFindings: Finding[] = collectAllFindings(root)
    .filter((f) => !EXCLUDED_RULE_IDS.has(f.warning.ruleId))
    .map((f) => ({ nodeId: f.nodeId, family: ruleFamily(f.warning.ruleId), warning: f.warning }))

  const dimensions = {} as Record<QueryHealthDimension, DimensionResult>
  for (const dimension of QUERY_HEALTH_DIMENSIONS) {
    if (!isDimensionEligible(dimension, nodes, context)) {
      dimensions[dimension] = { status: "insufficient-data" }
      continue
    }
    const families = new Set(DIMENSION_RULE_FAMILIES[dimension])
    const dimensionFindings = allFindings.filter((f) => families.has(f.family))
    dimensions[dimension] = scoreEligibleDimension(dimensionFindings)
  }

  const scored = QUERY_HEALTH_DIMENSIONS.map((d) => dimensions[d]).filter((r): r is DimensionScored => r.status === "scored")
  const overall: DimensionResult =
    scored.length === 0 ? { status: "insufficient-data" } : { status: "scored", score: clamp0to100(scored.reduce((sum, r) => sum + r.score, 0) / scored.length) }

  return { overall, dimensions, ...countNodesBySeverity(nodes) }
}
