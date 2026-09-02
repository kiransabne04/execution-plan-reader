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

import { collectNodes, type PlanNode, type Warning } from "../parsers/normalize"
import type { PlanContext, Rule } from "./types"

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

function checkPostgresNode(node: PlanNode): Warning[] {
  const planned = node.parallel?.workersPlanned
  const launched = node.parallel?.workersLaunched
  if (planned === undefined || launched === undefined) return []
  const severity = parallelShortfallSeverity(planned, launched)
  if (!severity) return []

  return [
    {
      ruleId: "parallel-worker-shortfall",
      severity,
      shortText: `Planned ${planned} parallel workers, only ${launched} launched.`,
      longText:
        `This ${node.rawOperatorLabel} planned to use ${planned} parallel worker${planned === 1 ? "" : "s"}, but only ` +
        `${launched} ${launched === 1 ? "was" : "were"} actually launched at execution time. This usually means ` +
        `Postgres's worker pool (max_parallel_workers / max_worker_processes) was exhausted by other concurrent ` +
        `activity on the instance when this query ran — this single plan can't confirm what else was running, only ` +
        `that fewer workers than planned were available.`,
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
  if (node.engine === "postgres") return checkPostgresNode(node)
  return []
}
