// MVP rule 5: exploding join — output rows far exceeding input rows, the
// classic signature of an accidental cross join / missing join condition.

import { formatNumber } from "./format"
import type { Rule } from "./types"

export const EXPLOSION_RATIO_THRESHOLD = 10

const JOIN_OPERATOR_TYPES = new Set(["hash_join", "nested_loop_join", "merge_join", "join", "cartesian_join"])

export const explodingJoin: Rule = (node) => {
  if (!JOIN_OPERATOR_TYPES.has(node.operatorType)) return []

  const outputRows = node.actualRows ?? node.estimatedRows
  if (outputRows === undefined || !Number.isFinite(outputRows) || outputRows <= 0) return []

  const childRowCounts = node.children
    .map((c) => c.actualRows ?? c.estimatedRows)
    .filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  if (childRowCounts.length === 0) return []

  const maxInputRows = Math.max(...childRowCounts)
  const ratio = outputRows / maxInputRows
  if (ratio < EXPLOSION_RATIO_THRESHOLD) return []

  const ratioText = formatNumber(Math.round(ratio))

  return [
    {
      ruleId: "exploding-join",
      severity: node.operatorType === "cartesian_join" ? "critical" : "warning",
      shortText: `Output (${formatNumber(outputRows)} rows) is ${ratioText}x its largest input — check the join condition.`,
      longText:
        `This ${node.rawOperatorLabel} produced ${formatNumber(outputRows)} rows from inputs of at most ` +
        `${formatNumber(maxInputRows)} rows — a ${ratioText}x multiplication. This pattern usually means a ` +
        `missing or too-loose join condition (an accidental cross join), causing rows to multiply rather than ` +
        `match one-to-one/one-to-many as intended.`,
    },
  ]
}
