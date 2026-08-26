// MVP rule 2: estimate-vs-actual row mismatch beyond a threshold ratio.
// Required suppression: BitmapAnd/BitmapOr always report actual rows = 0 on
// Postgres — a genuine engine quirk, not a real mismatch. See
// .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/postgres-plan-parsing/SKILL.md.

import { formatNumber } from "./format"
import type { Rule } from "./types"

export const MISMATCH_RATIO_THRESHOLD = 10

const SUPPRESSED_OPERATOR_TYPES = new Set(["bitmap_and", "bitmap_or"])

export const badRowEstimate: Rule = (node) => {
  if (SUPPRESSED_OPERATOR_TYPES.has(node.operatorType)) return []

  const { estimatedRows, actualRows } = node
  if (
    estimatedRows === undefined ||
    actualRows === undefined ||
    !Number.isFinite(estimatedRows) ||
    !Number.isFinite(actualRows) ||
    estimatedRows <= 0 ||
    actualRows < 0
  ) {
    return [] // insufficient/degenerate data — treat as "can't tell", never guess
  }

  const ratio = actualRows === 0 ? Infinity : actualRows / estimatedRows
  const isBad = ratio >= MISMATCH_RATIO_THRESHOLD || ratio <= 1 / MISMATCH_RATIO_THRESHOLD
  if (!isBad) return []

  const direction = ratio > 1 ? "more" : "fewer"
  const factor = ratio > 1 ? ratio : 1 / ratio
  const factorText = Number.isFinite(factor) ? `${formatNumber(Math.round(factor))}x` : "far"

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
