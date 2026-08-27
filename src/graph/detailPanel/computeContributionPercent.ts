// Story 6.2, panel section 6: "this node's cost/time as a percentage of the
// total plan — a number no competitor tool surfaces clearly." Postgres/SQL
// Server's actual-time and cost figures are already cumulative from the top
// of a node's own subtree (a node's `actualTimeMs`/`estimatedCost` already
// includes its children's), so the plan ROOT's own value already IS the
// plan-wide total — no separate summation across every node is needed, and
// the root's contribution is 100% by definition purely from this ratio
// (root-value / root-value), with no special-casing required.
//
// Must never render NaN%/Infinity% on a degenerate plan (zero-cost/zero-time
// plans are legitimate input) — returns undefined (an honest "not
// available") rather than a nonsensical number.

import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"

export function computeContributionPercent(node: PlanNode, context: PlanContext): number | undefined {
  const total = context.totalActualTimeMs ?? context.totalEstimatedCost
  if (total === undefined || !Number.isFinite(total) || total <= 0) return undefined

  const value = node.actualTimeMs ?? node.estimatedCost
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined

  return (value / total) * 100
}
