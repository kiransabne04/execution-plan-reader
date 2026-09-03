// MVP rule 2: estimate-vs-actual row mismatch beyond a threshold ratio.
// Required suppression: BitmapAnd/BitmapOr always report actual rows = 0 on
// Postgres — a genuine engine quirk, not a real mismatch. See
// .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/postgres-plan-parsing/SKILL.md.
//
// Episode 25, Story 25.4 — severity used to be a flat "warning" the moment
// the ratio cleared MISMATCH_RATIO_THRESHOLD. A 50x ratio on 1 → 50 rows
// and a 50,000x ratio on 10 → 500,000 rows are not equally material, even
// though both clear the same ratio gate — severity is now graded using
// ratio, absolute row difference, this node's own share of total plan
// runtime, and whether the node feeds a join (see
// `severityForEstimateError` below). The firing GATE itself
// (`computeMismatchFactor`'s own `isBad`) is UNCHANGED — still ratio-only —
// so the mismatch badge (`buildGraphElements.ts`) and this rule keep
// agreeing on WHETHER a mismatch is worth surfacing at all; only the
// severity assigned to an already-firing mismatch is new.
//
// Story 25.5 — the old longText named "stale table statistics" as "the
// most common cause," stated as settled fact this app can't actually
// verify from one pasted plan. Replaced with an investigate-list
// (statistics freshness, column correlation, extended statistics,
// predicates, parameter values) — never "your statistics are stale."

import type { PlanNode, Warning } from "../parsers/normalize"
import { JOIN_OPERATOR_TYPES } from "./explodingJoin"
import { formatNumber } from "./format"
import type { PlanContext, Rule } from "./types"

export const MISMATCH_RATIO_THRESHOLD = 10

/** Below this many rows of absolute difference, even a huge RATIO isn't
 * material — 1 → 50 rows is technically a 50x mismatch but is only 49 rows
 * of real-world consequence, the story's own "might be harmless" example.
 * Below this floor, severity is capped at `info` regardless of ratio. */
export const ABS_ROW_DIFFERENCE_MATERIALITY_FLOOR = 500

/** A ratio at or above this is "very large" on its own — one of three
 * independent escalation signals toward `critical` (see
 * `severityForEstimateError`). `factor === undefined` (the near-infinite
 * actualRows === 0 case) always counts as very large too. */
export const LARGE_RATIO_THRESHOLD = 1_000

/** This node's own share of the plan's total actual runtime, at or above
 * which the estimate error is judged to have a meaningful runtime
 * contribution — a second independent escalation signal. */
export const RUNTIME_SHARE_THRESHOLD = 0.1

const SUPPRESSED_OPERATOR_TYPES = new Set(["bitmap_and", "bitmap_or"])

export interface MismatchFactorResult {
  isBad: boolean
  /** Rounded whole number, or `undefined` for the near-infinite-ratio case
   * (actualRows === 0 with a positive estimate) — there's no clean number
   * to show for that, only "far" (this rule's own prose fallback). */
  factor: number | undefined
  direction: "more" | "fewer"
}

/**
 * Pure: the row-count mismatch ratio between estimated and actual rows.
 * Shared by this rule's own prose (`shortText`/`longText` below) AND
 * `buildGraphElements.ts`'s node-card mismatch badge (spec §3: "Badges |
 * ... mismatch factor" — the design mockup renders this as "est. mismatch
 * 95×") — one source of truth for the number, not two independently
 * computed ratios that could silently drift apart from each other.
 */
export function computeMismatchFactor(
  estimatedRows: number | undefined,
  actualRows: number | undefined,
): MismatchFactorResult | undefined {
  if (
    estimatedRows === undefined ||
    actualRows === undefined ||
    !Number.isFinite(estimatedRows) ||
    !Number.isFinite(actualRows) ||
    estimatedRows <= 0 ||
    actualRows < 0
  ) {
    return undefined // insufficient/degenerate data — treat as "can't tell", never guess
  }

  const ratio = actualRows === 0 ? Infinity : actualRows / estimatedRows
  const isBad = ratio >= MISMATCH_RATIO_THRESHOLD || ratio <= 1 / MISMATCH_RATIO_THRESHOLD
  const direction = ratio > 1 ? "more" : "fewer"
  const rawFactor = ratio > 1 ? ratio : 1 / ratio
  const factor = Number.isFinite(rawFactor) ? Math.round(rawFactor) : undefined
  return { isBad, factor, direction }
}

/**
 * Story 25.4's materiality grading, kept as its own pure function so it's
 * directly unit-testable against the story's two worked examples without
 * going through the full rule. Three independent escalation signals toward
 * `critical` — a very large ratio, a meaningful share of total runtime, and
 * feeding a join (join algorithm selection leans heavily on row estimates,
 * so a bad estimate ON a join node itself is more consequential than one on
 * a leaf scan) — deliberately checked as "how many of these three hold",
 * not any single one alone, so no one factor can unilaterally force
 * `critical`. The absolute-row-difference floor is a hard cap checked
 * FIRST: below it, the finding still surfaces (it's real, and still shown),
 * but never above `info` — a 50x ratio on 49 rows is not worth a warning
 * regardless of how the other three signals look.
 *
 * NOTE on "join impact": this only checks whether THIS node itself is a
 * join operator — not whether a DESCENDANT join further up the tree
 * consumes this node's output (that fuller, ancestry-aware relationship is
 * `cardinalityPropagation.ts`'s own job, Story 25.1/25.7, which this rule
 * deliberately doesn't reach for — a single-node `Rule` function has no
 * business walking the tree itself).
 */
export function severityForEstimateError(
  node: Pick<PlanNode, "operatorType" | "actualTimeMs">,
  estimatedRows: number,
  actualRows: number,
  factor: number | undefined,
  context: Pick<PlanContext, "hasActualData" | "totalActualTimeMs">,
): Warning["severity"] {
  const absDifference = Math.abs(actualRows - estimatedRows)
  if (absDifference < ABS_ROW_DIFFERENCE_MATERIALITY_FLOOR) return "info"

  const veryLargeRatio = factor === undefined || factor >= LARGE_RATIO_THRESHOLD
  const meaningfulRuntimeShare =
    context.hasActualData &&
    context.totalActualTimeMs !== undefined &&
    context.totalActualTimeMs > 0 &&
    node.actualTimeMs !== undefined &&
    node.actualTimeMs / context.totalActualTimeMs >= RUNTIME_SHARE_THRESHOLD
  const feedsJoin = JOIN_OPERATOR_TYPES.has(node.operatorType)

  const escalationSignals = [veryLargeRatio, meaningfulRuntimeShare, feedsJoin].filter(Boolean).length
  return escalationSignals >= 2 ? "critical" : "warning"
}

export const badRowEstimate: Rule = (node, context) => {
  if (SUPPRESSED_OPERATOR_TYPES.has(node.operatorType)) return []

  const { estimatedRows, actualRows } = node
  // Redundant with the guard inside computeMismatchFactor, but restores
  // TypeScript's narrowing at this call site (a plain function call can't
  // narrow the caller's own locals the way an inline check can) — cheap,
  // and keeps this file free of non-null assertions.
  if (estimatedRows === undefined || actualRows === undefined) return []

  const result = computeMismatchFactor(estimatedRows, actualRows)
  if (!result || !result.isBad) return []

  const { direction, factor } = result
  const factorText = factor !== undefined ? `${formatNumber(factor)}x` : "far"
  const severity = severityForEstimateError(node, estimatedRows, actualRows, factor, context)

  return [
    {
      ruleId: "bad-row-estimate",
      severity,
      shortText: `Estimate off by ${factorText}: expected ${formatNumber(estimatedRows)} rows, got ${formatNumber(actualRows)}.`,
      longText:
        `The planner estimated ${formatNumber(estimatedRows)} rows for this ${node.rawOperatorLabel} but ` +
        `${formatNumber(actualRows)} actually came out — ${factorText} ${direction} than expected. Bad estimates ` +
        `like this often cascade into a worse plan shape further up the tree (e.g. the wrong join algorithm gets ` +
        `picked). This single plan can't confirm the cause — worth investigating statistics freshness, column ` +
        `correlation, whether extended statistics would help, the predicates involved, or the specific parameter ` +
        `values used for this run.`,
    },
  ]
}
