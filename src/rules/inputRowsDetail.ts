// Shared machinery for "how many rows entered this operator." Snowflake's
// own `input_rows` (`PlanNode.inputRows` — see its own doc comment in
// normalize.ts) is a real, engine-reported figure when present; several
// rules (`explodingJoin.ts` and everything built on its own "input rows
// via children" technique — the Episode 32/34 hotspot/DML rules) previously
// had no choice but to derive an approximation by summing/maxing children's
// `actualRows`/`estimatedRows`. Now that the real field is captured, every
// one of those call sites should prefer it, falling back to the same
// derivation only when it's genuinely absent — one shared function, so the
// preference order can't drift differently across files.
//
// Kept engine-agnostic in shape (not Snowflake-prefixed) even though only
// Snowflake ever populates `inputRows` today: for Postgres/SQL Server,
// `node.inputRows` is always `undefined`, so this always falls through to
// the exact same children-derivation those rules already did — a safe,
// behavior-preserving drop-in for `explodingJoin.ts`'s own cross-engine use.

import type { PlanNode } from "../parsers/normalize"

/**
 * Resolves the input row count for `node`: prefers the real
 * `node.inputRows` when present and positive, otherwise falls back to the
 * max of its children's own `actualRows` (or `estimatedRows`, for an
 * estimate-only Postgres/SQL Server plan — the same fallback
 * `explodingJoin.ts` always used). `undefined` when neither source has
 * anything usable.
 */
export function resolveInputRows(node: PlanNode): number | undefined {
  const native = node.inputRows
  if (native !== undefined && Number.isFinite(native) && native > 0) return native

  const childRows = node.children
    .map((c) => c.actualRows ?? c.estimatedRows)
    .filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  if (childRows.length === 0) return undefined
  return Math.max(...childRows)
}

/** Whether `resolveInputRows` would return the real, engine-reported
 * `node.inputRows` rather than a derived approximation — used only to
 * decide whether a rule's own text needs a "this is computed, not
 * reported" disclosure (see `filterRowsDiscarded.ts`). */
export function isNativeInputRows(node: PlanNode): boolean {
  const native = node.inputRows
  return native !== undefined && Number.isFinite(native) && native > 0
}
