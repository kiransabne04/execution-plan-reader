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
    estimatedCost: overrides.estimatedCost,
    actualTimeMs: overrides.actualTimeMs,
    loops: overrides.loops,
    role: overrides.role ?? ("main" as PlanNodeRole),
    children: overrides.children ?? [],
    attributes: overrides.attributes ?? {},
    warnings: overrides.warnings ?? [],
  }
}

export function makeContext(root: PlanNode, overrides: Partial<PlanContext> = {}): PlanContext {
  return { ...buildPlanContext(root), ...overrides }
}
