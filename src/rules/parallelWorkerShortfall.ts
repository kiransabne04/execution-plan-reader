// Episode 23, Story 23.2 — parallel-worker shortfall: the query asked for
// parallel execution but didn't fully get it. See
// .claude/skills/rule-engine-authoring/SKILL.md and
// docs/08-episodes-and-stories.md Episode 23's own dimension table before
// editing.
//
// Postgres and SQL Server each have a genuinely different shape of
// "planned vs. actually got" here — this file keeps them as two separate
// checks sharing one severity-scaling helper, not one code path forced to
// fit both:
//
// - Postgres: per-node. Every parallel-eligible node carries its own
//   `workersPlanned`/`workersLaunched` (`extendedFields.ts`).
// - SQL Server: query-level. The compiled plan's degree of parallelism
//   (`QueryPlan`'s own `DegreeOfParallelism` XML attribute,
//   `parseShowplanXml.ts`, root-node-only) is a single whole-plan fact —
//   SQL Server has no per-operator "planned" concept the way Postgres
//   does. Compared against the MAX per-node thread count actually
//   observed anywhere in the tree at runtime.
//
// Snowflake has no signal here at all (no per-node or per-query worker/
// thread field `GET_QUERY_OPERATOR_STATS()` exposes) — this rule simply
// never fires there, by construction (every field both checks read is
// always `undefined` for a Snowflake node), not a special-cased branch.
//
// Episode 25, Story 25.6 — three additions to the Postgres path, all
// enrichment on an ALREADY-firing shortfall (matching the existing SQL
// Server `NonParallelPlanReason` pattern below — never a second,
// independent trigger condition of their own, which would risk exactly
// the false-positive-erodes-trust failure mode `rule-engine-authoring`
// warns about): (1) the shortfall's own severity restated in plain words,
// not just implied by critical/warning; (2) whether this node's own share
// of total plan runtime was even meaningful — a shortfall on a parallel
// portion that barely mattered to total runtime is a different story than
// one on the plan's dominant cost; (3) Gather/Gather Merge's own
// coordination overhead (its own actualTimeMs beyond its slowest child's),
// when the node IS a Gather/Gather Merge and that overhead is real.
// PER-WORKER IMBALANCE IS DELIBERATELY NOT ADDED — checked against
// `extendedFields.ts` first: Postgres's own per-worker `Workers` array
// (individual worker actual rows/time) is not parsed anywhere in this
// codebase today, only the aggregate `workersLaunched`/`workersPlanned`.
// Inventing a per-worker-skew finding without that data would be
// fabrication this story's own instruction explicitly forbids.

import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"
import type { PlanContext, Rule } from "./types"

/** Below this share of total plan runtime, the parallel portion of the
 * query was a small enough slice of the whole that a shortfall there is
 * unlikely to matter much to overall performance — noted, not suppressed
 * (the shortfall is still real and still shown). */
export const INSIGNIFICANT_RUNTIME_SHARE_THRESHOLD = 0.05

/** A Gather/Gather Merge's own coordination overhead (its actualTimeMs
 * beyond its slowest child) below this many ms isn't worth mentioning even
 * if proportionally large — avoids a technically-true but practically
 * meaningless note on a fast query. */
export const MATERIAL_GATHER_OVERHEAD_MS_THRESHOLD = 50

const GATHER_OPERATOR_TYPES = new Set(["gather", "gather_merge"])

/** Shared by both engine paths — a real shortfall grades by degree, not
 * mere existence, mirroring `bufferCacheInefficiency.ts`'s own threshold-
 * scaled severity rather than firing binary. `undefined` means "no
 * shortfall, don't fire" (covers `launched >= planned`, including the
 * `launched > planned` case that shouldn't happen per either engine's own
 * semantics but isn't provably impossible to rule out). */
export function parallelShortfallSeverity(planned: number, launched: number): Warning["severity"] | undefined {
  if (launched >= planned) return undefined
  return launched === 0 || launched < planned / 2 ? "critical" : "warning"
}

/** Story 25.6, addition 1 — the shortfall's own severity restated in plain
 * words, next to the numbers rather than only implied by the finding's
 * `severity` field. */
function describeShortfallDegree(severity: Warning["severity"], launched: number): string {
  if (launched === 0) return "No workers at all were launched"
  return severity === "critical" ? "Fewer than half the planned workers were launched" : "Most, but not all, planned workers were launched"
}

/** Story 25.6, addition 2 — was the parallel portion of this query even a
 * meaningful share of total runtime? `undefined` when there isn't enough
 * data to say (no actual data, or no total to compare against). */
function describeRuntimeSignificance(node: PlanNode, context: PlanContext): string | undefined {
  if (!context.hasActualData || context.totalActualTimeMs === undefined || context.totalActualTimeMs <= 0) return undefined
  if (node.actualTimeMs === undefined) return undefined
  const share = node.actualTimeMs / context.totalActualTimeMs
  if (share < INSIGNIFICANT_RUNTIME_SHARE_THRESHOLD) {
    return (
      `This parallel portion accounted for only about ${(share * 100).toFixed(1)}% of the query's total runtime, so ` +
      `even with the shortfall, its impact on overall performance was likely small.`
    )
  }
  return `This parallel portion accounted for about ${(share * 100).toFixed(1)}% of the query's total runtime — a meaningful share, so this shortfall likely mattered to overall performance.`
}

/** Story 25.6, addition 3 — Gather/Gather Merge's own coordination
 * overhead: its own actualTimeMs beyond its slowest child's, when the node
 * IS a Gather/Gather Merge and that overhead clears a real-ms floor. Never
 * fabricated when the node isn't a Gather, or when children carry no
 * actual-time data to compare against. */
function describeGatherOverhead(node: PlanNode): string | undefined {
  if (!GATHER_OPERATOR_TYPES.has(node.operatorType)) return undefined
  if (node.actualTimeMs === undefined) return undefined
  const childTimes = node.children.map((c) => c.actualTimeMs).filter((t): t is number => t !== undefined && Number.isFinite(t))
  if (childTimes.length === 0) return undefined
  const overheadMs = node.actualTimeMs - Math.max(...childTimes)
  if (!Number.isFinite(overheadMs) || overheadMs < MATERIAL_GATHER_OVERHEAD_MS_THRESHOLD) return undefined
  return (
    `This ${node.rawOperatorLabel} node itself added about ${overheadMs.toFixed(0)}ms beyond its slowest child — the ` +
    `cost of collecting and merging worker output, on top of the shortfall above.`
  )
}

function checkPostgresNode(node: PlanNode, context: PlanContext): Warning[] {
  const planned = node.parallel?.workersPlanned
  const launched = node.parallel?.workersLaunched
  if (planned === undefined || launched === undefined) return []
  const severity = parallelShortfallSeverity(planned, launched)
  if (!severity) return []

  const degreeNote = describeShortfallDegree(severity, launched)
  const runtimeNote = describeRuntimeSignificance(node, context)
  const gatherNote = describeGatherOverhead(node)
  const enrichment = [runtimeNote, gatherNote].filter((n): n is string => n !== undefined)
  const enrichmentText = enrichment.length > 0 ? ` ${enrichment.join(" ")}` : ""

  return [
    {
      ruleId: "parallel-worker-shortfall",
      severity,
      shortText: `Planned ${planned} parallel workers, only ${launched} launched.`,
      longText:
        `This ${node.rawOperatorLabel} planned to use ${planned} parallel worker${planned === 1 ? "" : "s"}, but only ` +
        `${launched} ${launched === 1 ? "was" : "were"} actually launched at execution time. ${degreeNote} — this ` +
        `usually means Postgres's worker pool (max_parallel_workers / max_worker_processes) was exhausted by other ` +
        `concurrent activity on the instance when this query ran; this single plan can't confirm what else was ` +
        `running, only that fewer workers than planned were available.${enrichmentText}`,
    },
  ]
}

// Episode 23's own dimension table's honesty note, restated here at the
// point that matters: this app has no verified, complete enumeration of
// every NonParallelPlanReason string SQL Server can emit, and some
// describe a deliberate configuration choice (e.g. an explicit MAXDOP
// setting), not a problem. Treating an unclassified reason string as an
// independent trigger risks exactly the false-positive-erodes-trust
// failure mode rule-engine-authoring warns about — it's surfaced only as
// enrichment on a shortfall ALREADY detected numerically below, never a
// second trigger condition of its own.
function checkSqlServerQueryLevel(node: PlanNode, context: PlanContext): Warning[] {
  if (node.id !== context.rootId) return [] // whole-plan-level fact, surfaced once — same pattern as parameterSensitivityNote.ts
  // Without real per-node thread-count data, `maxObservedThreads` below
  // would compute as 0 for every node (the field is simply never
  // populated on an estimate-only plan) — making every compiled-parallel
  // estimate-only SQL Server plan look like a total shortfall. A serious,
  // systematic false positive this gate exists specifically to prevent.
  if (!context.hasActualData) return []
  const planned = context.compiledDegreeOfParallelism
  if (planned === undefined || planned <= 1) return [] // never intended to be parallel — the common case for most real queries

  const maxObservedThreads = Math.max(0, ...collectNodes(node).map((n) => n.parallel?.workersLaunched ?? 0))
  const severity = parallelShortfallSeverity(planned, maxObservedThreads)
  if (!severity) return []

  const reason = node.parallel?.nonParallelPlanReason
  const reasonNote = reason ? ` SQL Server recorded the reason: "${reason}".` : ""

  return [
    {
      ruleId: "parallel-worker-shortfall",
      severity,
      shortText: `Compiled for DOP ${planned}, only ${maxObservedThreads} thread${maxObservedThreads === 1 ? "" : "s"} observed at runtime.`,
      longText:
        `This plan was compiled for a degree of parallelism of ${planned}, but at execution time no operator in it ` +
        `ran with more than ${maxObservedThreads} thread${maxObservedThreads === 1 ? "" : "s"}.${reasonNote} This usually ` +
        `means server-level parallel resources (CPU/scheduler availability) were constrained when this query ran — ` +
        `this single plan can't confirm what else was running, only that fewer threads than compiled for were ` +
        `actually used.`,
    },
  ]
}

export const parallelWorkerShortfall: Rule = (node, context) => {
  if (node.engine === "sqlserver") return checkSqlServerQueryLevel(node, context)
  if (node.engine === "postgres") return checkPostgresNode(node, context)
  return []
}
