// Postgres parser entry point. Each format has its own pure function
// (rawPlanText -> PlanNode); `parsePostgresPlan` just dispatches to the
// right one based on the cleaned input's shape, for callers (the paste box)
// that don't ask the user which format they used.

import { cleanup } from "./cleanup"
import { parsePostgresJsonPlan } from "./parseJsonPlan"
import { parsePostgresTextPlan } from "./textParser"
import type { PlanNode } from "../normalize"

export { parsePostgresJsonPlan } from "./parseJsonPlan"
export { parsePostgresTextPlan } from "./textParser"

export function parsePostgresPlan(rawInput: string): PlanNode {
  const cleaned = cleanup(rawInput)
  const looksLikeJson = cleaned.startsWith("[") || cleaned.startsWith("{")
  return looksLikeJson ? parsePostgresJsonPlan(rawInput) : parsePostgresTextPlan(rawInput)
}
