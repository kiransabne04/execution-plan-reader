// MVP rule 2: estimate-vs-actual row mismatch beyond a threshold ratio.
// Required suppression: BitmapAnd/BitmapOr always report actual rows = 0 on
// Postgres — a genuine engine quirk, not a real mismatch. See
// .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/postgres-plan-parsing/SKILL.md.

import { formatNumber } from "./format"
import type { Rule } from "./types"

export const MISMATCH_RATIO_THRESHOLD = 10

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

export const badRowEstimate: Rule = (node) => {
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

  return [
    {
      ruleId: "bad-row-estimate",
      severity: "warning",
      shortText: `Estimate off by ${factorText}: expected ${formatNumber(estimatedRows)} rows, got ${formatNumber(actualRows)}.`,
      longText:
        `The planner estimated ${formatNumber(estimatedRows)} rows for this ${node.rawOperatorLabel} but ` +
        `${formatNumber(actualRows)} actually came out — ${factorText} ${direction} than expected. Bad estimates ` +
        `like this often cascade into a worse plan shape further up the tree (e.g. the wrong join algorithm gets ` +
        `picked). Stale table statistics are the most common cause.`,
    },
  ]
}
