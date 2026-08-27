// Episode 6 Story 6.2 — operator glossary lookup. See
// .claude/skills/operator-glossary-content/SKILL.md.

import ENTRIES from "./entries"
import type { OperatorGlossaryEntry } from "./types"

export type { OperatorGlossaryEntry } from "./types"

const BY_OPERATOR_TYPE: ReadonlyMap<string, OperatorGlossaryEntry> = new Map(
  ENTRIES.map((entry) => [entry.operatorType, entry]),
)

/** `operatorType: "unknown"` deliberately never has an entry — it always
 * goes through the fallback below, same as any other uncovered type. */
export function getGlossaryEntry(operatorType: string): OperatorGlossaryEntry | undefined {
  if (operatorType === "unknown") return undefined
  return BY_OPERATOR_TYPE.get(operatorType)
}

export interface GlossaryFallback {
  displayName: string
  message: string
}

/** Never a blank/broken panel section — an uncovered operatorType (or the
 * explicit "unknown" normalization fallback) gets this instead. */
export function getGlossaryFallback(rawOperatorLabel: string): GlossaryFallback {
  return {
    displayName: rawOperatorLabel,
    message: "We don't have a detailed explanation for this operator yet.",
  }
}

/** For the "seen but unmapped" coverage-tracking discipline (see skill) —
 * every operatorType this glossary actually covers. */
export function coveredOperatorTypes(): string[] {
  return [...BY_OPERATOR_TYPE.keys()]
}
