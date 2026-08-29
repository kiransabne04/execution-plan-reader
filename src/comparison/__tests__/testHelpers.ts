import type { PlanNode, PlanNodeRole } from "../../parsers/normalize"

let counter = 0

/** Literal PlanNode builder for comparison unit tests — mirrors
 * `src/rules/__tests__/testHelpers.ts`'s `makeNode`. Matching is a pure
 * function over two PlanNode trees, so there's no need to go through a
 * parser/fixture file to construct precise before/after scenarios. */
export function makeNode(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: overrides.id ?? `test-${counter++}`,
    engine: overrides.engine ?? "postgres",
    operatorType: overrides.operatorType ?? "seq_scan",
    rawOperatorLabel: overrides.rawOperatorLabel ?? "Seq Scan",
    estimatedRows: overrides.estimatedRows,
    actualRows: overrides.actualRows,
    rowsRemovedByFilter: overrides.rowsRemovedByFilter,
    estimatedCost: overrides.estimatedCost,
    actualTimeMs: overrides.actualTimeMs,
    actualTimePerExecutionMs: overrides.actualTimePerExecutionMs,
    loops: overrides.loops,
    role: overrides.role ?? ("main" as PlanNodeRole),
    predicate: overrides.predicate,
    index: overrides.index,
    join: overrides.join,
    io: overrides.io,
    spill: overrides.spill,
    pruning: overrides.pruning,
    parallel: overrides.parallel,
    timeBreakdown: overrides.timeBreakdown,
    children: overrides.children ?? [],
    attributes: overrides.attributes ?? {},
    warnings: overrides.warnings ?? [],
  }
}
