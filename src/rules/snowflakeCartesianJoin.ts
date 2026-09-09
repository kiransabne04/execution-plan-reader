// Snowflake rule: cartesian-join. `operatorMap.ts` maps Snowflake's own
// `CartesianJoin` operation to `operatorType: "cartesian_join"` — a
// distinct, EXPLICIT operation name Snowflake itself emits when it
// identifies genuine cross-join semantics (no join condition connecting
// the two sides at all). This is real structural evidence from the
// engine, not an inference.
//
// This file's own explicit instruction: only flag when the operator data
// explicitly supports cross/cartesian semantics — do NOT infer cartesian-
// ness from output volume alone. `explodingJoin.ts`'s existing
// `exploding-join` finding already fires on ANY join type (including a
// plain `join`) purely from a large output/input RATIO — a big ratio on a
// generic Join is real evidence of a probable missing condition, but it
// is NOT the same claim as "this specific operator IS a cartesian join,"
// and conflating the two would be exactly the volume-based inference this
// story forbids. This rule is deliberately independent of that ratio
// math: it fires because Snowflake's own plan says "CartesianJoin,"
// period — a small row count doesn't make it any less structurally a
// cross join, though a floor still excludes a genuinely trivial one (a
// handful of literal rows crossed intentionally, e.g. a small constant
// table) from being worth its own finding.

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many output rows, a Cartesian join is too small to be worth
 * flagging on its own — the structural fact is still true, but a handful
 * of rows crossed is rarely worth a developer's attention. */
export const MIN_ROWS_THRESHOLD = 1_000

export const snowflakeCartesianJoin: Rule = (node) => {
  if (node.engine !== "snowflake" || node.operatorType !== "cartesian_join") return []

  const outputRows = node.actualRows
  if (outputRows === undefined || !Number.isFinite(outputRows) || outputRows < MIN_ROWS_THRESHOLD) return []

  const childRowCounts = node.children.map((c) => c.actualRows).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  const inputsText = childRowCounts.length > 0 ? childRowCounts.map((r) => formatNumber(r)).join(" × ") : undefined

  return [
    {
      ruleId: "cartesian-join",
      severity: "warning",
      shortText: `Snowflake's own plan explicitly classifies this as a Cartesian (cross) join, producing ${formatNumber(outputRows)} rows.`,
      longText:
        `Snowflake's query plan explicitly labels this operation "CartesianJoin" — not an inference from row volume, ` +
        `but the engine's own structural classification: no join condition connects the two inputs at all, so every ` +
        `row from one side is paired with every row from the other.${inputsText ? ` The inputs here are ${inputsText} rows.` : ""} ` +
        `This is sometimes intentional (a genuine cross join, e.g. generating combinations from a small reference ` +
        `set), but far more often it's the accidental result of a missing or incorrectly-written join condition — ` +
        `worth double-checking the query's own JOIN clause if this wasn't the intent.`,
      provenance: {
        threshold: `operatorType === "cartesian_join" (Snowflake's own explicit operation classification) AND output rows ≥ ${formatNumber(MIN_ROWS_THRESHOLD)}`,
        computed: formatNumber(outputRows),
      },
    },
  ]
}
