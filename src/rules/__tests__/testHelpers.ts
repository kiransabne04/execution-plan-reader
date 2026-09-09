import type { PlanNode, PlanNodeRole } from "../../parsers/normalize"
import { buildPlanContext, type PlanContext } from "../types"

let counter = 0

/** Literal PlanNode builder for rule unit tests — rules are pure functions
 * over PlanNode, so there's no need to go through a parser/fixture file to
 * exercise them precisely at a threshold boundary. */
export function makeNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: overrides.id ?? `test-${counter++}`,
    engine: overrides.engine ?? "postgres",
    operatorType: overrides.operatorType ?? "seq_scan",
    rawOperatorLabel: overrides.rawOperatorLabel ?? "Seq Scan",
    estimatedRows: overrides.estimatedRows,
    actualRows: overrides.actualRows,
    // Snowflake's real `input_rows` (see PlanNode's own doc comment) —
    // added immediately alongside its own capture this time, per the
    // lesson from Episode 34's own "new PlanNode field not wired into the
    // test helper" bug.
    inputRows: overrides.inputRows,
    rowsRemovedByFilter: overrides.rowsRemovedByFilter,
    // Episode 24
    rowsRemovedByJoinFilter: overrides.rowsRemovedByJoinFilter,
    heapFetches: overrides.heapFetches,
    estimatedCost: overrides.estimatedCost,
    startupCost: overrides.startupCost,
    planWidth: overrides.planWidth,
    outputColumns: overrides.outputColumns,
    actualTimeMs: overrides.actualTimeMs,
    actualTimePerExecutionMs: overrides.actualTimePerExecutionMs,
    actualStartupTimeMs: overrides.actualStartupTimeMs,
    loops: overrides.loops,
    rebinds: overrides.rebinds,
    rewinds: overrides.rewinds,
    role: overrides.role ?? ("main" as PlanNodeRole),
    predicate: overrides.predicate,
    index: overrides.index,
    join: overrides.join,
    io: overrides.io,
    spill: overrides.spill,
    pruning: overrides.pruning,
    // Episode 33 — Snowflake official-shape fields. Missing here meant any
    // test passing these via makeNode() overrides silently got `undefined`
    // instead of the value it asked for — the exact same "new PlanNode
    // field not wired into the test helper" bug class already caught once
    // for queryHealth.ts's dimension-eligibility checks.
    network: overrides.network,
    searchOptimization: overrides.searchOptimization,
    dml: overrides.dml,
    stepId: overrides.stepId,
    parallel: overrides.parallel,
    timeBreakdown: overrides.timeBreakdown,
    // Episode 24
    sort: overrides.sort,
    hash: overrides.hash,
    memoize: overrides.memoize,
    wal: overrides.wal,
    jit: overrides.jit,
    planningTimeMs: overrides.planningTimeMs,
    executionTimeMs: overrides.executionTimeMs,
    memoryGrant: overrides.memoryGrant,
    children: overrides.children ?? [],
    attributes: overrides.attributes ?? {},
    warnings: overrides.warnings ?? [],
  }
}

export function makeContext(root: PlanNode, overrides: Partial<PlanContext> = {}): PlanContext {
  return { ...buildPlanContext(root), ...overrides }
}
