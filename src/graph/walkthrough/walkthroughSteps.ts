// Episode 18, Story 18.9 — the walkthrough's step order and inclusion
// filter, as a pure function over a `PlanNode` tree — no React, no
// rendering — mirroring how buildGraphElements.ts and the rule engine are
// each tested as pure logic separate from their React wrappers. See
// docs/12-ui-redesign-spec.md §5 `1g`.

import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { computeContributionPercent } from "../detailPanel/computeContributionPercent"

/** Spec §5 `1g`: "post-order traversal (leaves/execution order first),
 * filtered to nodes carrying a warning or ≥10% contribution... root always
 * included regardless of the filter." */
const CONTRIBUTION_THRESHOLD_PERCENT = 10

export interface WalkthroughResult {
  steps: PlanNode[]
  /** True when the root is the ONLY step — nothing else in the plan met
   * the warning-or-contribution filter. The walkthrough UI uses this to
   * render an honest "nothing else stood out" state instead of a
   * one-step tour that could read as broken (this story's own edge case). */
  isMinimal: boolean
}

/**
 * Post-order (children before their own parent) so leaves come first —
 * "execution order," the order Postgres/SQL Server/Snowflake actually run
 * operators in, always starts at the leaves and finishes at the root.
 * Reuses `collectNodes`'s own "visit once, by id" dedup pattern
 * (parsers/normalize.ts) for the same shared-reference/multi-parent DAG
 * case (Snowflake's CTEs) that traversal already has to handle — this is
 * still, underneath, the same DAG, so it gets the same dedup rule rather
 * than a second traversal semantics being invented here.
 */
export function computeWalkthroughSteps(root: PlanNode, context: PlanContext): WalkthroughResult {
  const seen = new Set<string>()
  const steps: PlanNode[] = []

  const visit = (node: PlanNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    node.children.forEach(visit)

    const isRoot = node.id === root.id
    const contribution = computeContributionPercent(node, context)
    const meetsFilter = node.warnings.length > 0 || (contribution !== undefined && contribution >= CONTRIBUTION_THRESHOLD_PERCENT)
    if (isRoot || meetsFilter) steps.push(node)
  }
  visit(root)

  return { steps, isMinimal: steps.length <= 1 }
}
