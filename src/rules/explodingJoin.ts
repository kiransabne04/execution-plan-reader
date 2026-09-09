// MVP rule 5: exploding join — output rows far exceeding input rows, the
// classic signature of an accidental cross join / missing join condition.
//
// Episode 32, Story 32.1 — Snowflake-specific enrichment on this same
// finding, not a second rule: Snowflake's own generic `Join` operation
// (`operatorMap.ts`) never reveals which physical algorithm actually ran
// (no hash/merge/nested-loop distinction the way Postgres/SQL Server
// expose) — this rule already used `node.rawOperatorLabel` (the genuine
// engine label, "Join"/"CartesianJoin") rather than a fabricated one, so
// it never mislabeled anything, but it also never said so explicitly. A
// Snowflake-only sentence now states this plainly, using "input
// cardinality"/"output cardinality" as this story's own requested
// vocabulary, so a reader doesn't quietly assume "Join" means a hash join
// just because that's the common mental model from other engines.
//
// Input-rows resolution now goes through `inputRowsDetail.ts`'s shared
// `resolveInputRows()` — prefers Snowflake's own real `input_rows` when
// present, falling back to the same "max of children" derivation this
// file always used (still the only path for Postgres/SQL Server, which
// never populate `inputRows`). See that file's own header comment.

import { isNativeInputRows, resolveInputRows } from "./inputRowsDetail"
import { formatNumber } from "./format"
import type { Rule } from "./types"

export const EXPLOSION_RATIO_THRESHOLD = 10

// Exported for Episode 25's `badRowEstimate.ts`, which reuses this exact
// same operator-type set to check whether a bad-estimate node IS itself a
// join (its own "join impact" materiality factor) — not a second,
// independently-drifting copy of which operator types count as a join.
export const JOIN_OPERATOR_TYPES = new Set(["hash_join", "nested_loop_join", "merge_join", "join", "cartesian_join"])

export const explodingJoin: Rule = (node) => {
  if (!JOIN_OPERATOR_TYPES.has(node.operatorType)) return []

  const outputRows = node.actualRows ?? node.estimatedRows
  if (outputRows === undefined || !Number.isFinite(outputRows) || outputRows <= 0) return []

  const maxInputRows = resolveInputRows(node)
  if (maxInputRows === undefined) return []

  const ratio = outputRows / maxInputRows
  if (ratio < EXPLOSION_RATIO_THRESHOLD) return []

  const ratioText = formatNumber(Math.round(ratio))

  // Story 32.1's own explicit instruction: never let a generic Snowflake
  // "Join" read as if it were specifically a hash join. Only added for
  // Snowflake's own generic `join` type — `cartesian_join` already IS an
  // explicit Snowflake operation name (nothing ambiguous to disclose
  // there), and Postgres/SQL Server's own `join`/generic types (their
  // "algorithm not surfaced separately" case) have a different, already-
  // correct disclosure in the glossary rather than this rule's own text.
  const snowflakeAlgorithmNote =
    node.engine === "snowflake" && node.operatorType === "join"
      ? ` Snowflake's own plan output doesn't reveal which physical join algorithm actually ran here — this is ` +
        `simply its generic "Join" operation, not specifically a hash join or any other named algorithm.`
      : ""

  // Native `input_rows` (Snowflake's own real, reported figure) is a
  // single total for the operator, not specifically "the largest side" —
  // the derived fallback (max of children) IS specifically that. Wording
  // adapts so neither source is described as the other.
  const inputRowsPhrase = isNativeInputRows(node)
    ? `of ${formatNumber(maxInputRows)} rows (input cardinality)`
    : `of at most ${formatNumber(maxInputRows)} rows (input cardinality)`

  return [
    {
      ruleId: "exploding-join",
      severity: node.operatorType === "cartesian_join" ? "critical" : "warning",
      shortText: `Output (${formatNumber(outputRows)} rows) is ${ratioText}x its largest input — check the join condition.`,
      longText:
        `This ${node.rawOperatorLabel} produced ${formatNumber(outputRows)} rows (output cardinality) from inputs ` +
        `${inputRowsPhrase} — a ${ratioText}x multiplication.${snowflakeAlgorithmNote} ` +
        `This pattern usually means a missing or too-loose join condition (an accidental cross join), causing rows ` +
        `to multiply rather than match one-to-one/one-to-many as intended.`,
      provenance: {
        threshold: `output_rows / max_input_rows ≥ ${EXPLOSION_RATIO_THRESHOLD}`,
        computed: `${ratio.toFixed(2)}x`,
      },
    },
  ]
}
