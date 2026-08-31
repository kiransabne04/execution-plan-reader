// Non-sargable predicate: a filter or join condition that wraps an
// indexed column in a function, or compares it with a leading-wildcard
// LIKE, can't be satisfied by an ordinary B-tree index seek even when one
// exists on that exact column — the engine has no choice but to evaluate
// the expression against every row it already read, the same cost as if
// no index existed at all. See .claude/skills/rule-engine-authoring/SKILL.md.
//
// Deliberately checked against `predicate.filter`/`predicate.joinCondition`
// ONLY, never `predicate.indexCondition` — a condition that made it into
// an index seek/condition demonstrably DID use an index, whatever it
// happens to look like syntactically (a matching expression/functional
// index the plan text alone can't rule out) — flagging that would be a
// false positive by construction, and this rule engine's own MVP rule 1
// comment (seqScanOnLargeTable.ts) is explicit that a false "you're doing
// it wrong" erodes trust as much as a missed one.
//
// INFO severity, not warning/critical: this is a regex over a free-text
// predicate string — a syntactic pattern match, not a guaranteed
// diagnosis (a functional index matching the exact expression would make
// this perfectly fine, and nothing in the plan text can rule that out).
// Same confidence level missingIndexOpportunity.ts already settled on for
// its own inferred, not-100%-certain index finding — that rule's own
// comment calls a shakier inferred heuristic a real risk to user trust,
// which is exactly why this stays at "worth knowing," not "something's
// wrong."

import type { PlanNode, Warning } from "../parsers/normalize"
import type { Rule } from "./types"

// `func(column_or_qualified_column) <comparison>` — the single most common
// non-sargable pattern (`lower(name) = ...`, `CAST(col AS ...) = ...`,
// `date(created_at) > ...`). Requires an identifier-shaped argument (must
// start with a letter/underscore/bracket, never a digit or quote) so a
// function applied to a LITERAL instead of a column (`lower('ABC')`,
// `now()`) — which is perfectly sargable, the column itself is untouched
// — never matches. A qualified name (`table.column`) is allowed via the
// embedded dot, and SQL Server's own `[bracket-quoted]` identifiers are
// allowed via the optional brackets.
const FUNCTION_WRAPPED_COLUMN = /\b[a-zA-Z_][a-zA-Z0-9_]*\(\s*\[?[a-zA-Z_][a-zA-Z0-9_.]*\]?\s*\)\s*(=|<>|!=|<=|>=|<|>)/

// Leading-wildcard LIKE/ILIKE/NOT LIKE — `'%...'` can't use an ordered
// index the way a trailing-only wildcard (`'...%'`) still can (a prefix
// range scan) — deliberately NOT matched here. Two forms: the literal
// keyword (SQL Server/Snowflake predicate text) and Postgres's own
// internal rendering of LIKE/ILIKE as the `~~`/`~~*` operator (Postgres's
// `EXPLAIN` output never prints the word "LIKE" itself).
const LEADING_WILDCARD_LIKE = /(?:\b(?:not\s+)?i?like\s+|~~\*?\s*)'%/i

interface SargabilityMatch {
  explanation: string
}

function findNonSargablePattern(text: string): SargabilityMatch | undefined {
  const functionMatch = FUNCTION_WRAPPED_COLUMN.exec(text)
  if (functionMatch) {
    const snippet = functionMatch[0].replace(/\s*(=|<>|!=|<=|>=|<|>)$/, "").trim()
    return { explanation: `wraps a column in a function ("${snippet}")` }
  }
  if (LEADING_WILDCARD_LIKE.test(text)) {
    return { explanation: "uses a leading-wildcard LIKE (\"%...\")" }
  }
  return undefined
}

function buildWarning(node: PlanNode, clauseLabel: "filter" | "join condition", match: SargabilityMatch): Warning {
  return {
    ruleId: "non-sargable-predicate",
    severity: "info",
    shortText: `This ${clauseLabel} ${match.explanation} — that pattern can't use a B-tree index on the column, even if one exists.`,
    longText:
      `This ${node.rawOperatorLabel}'s ${clauseLabel} ${match.explanation}. An ordinary index can only match a ` +
      `column's raw stored value — once it's wrapped in a function or compared with a leading wildcard, the engine ` +
      `has to evaluate the expression against every row it reads, the same cost as if no index existed on that ` +
      `column at all. Rewriting the condition so the column itself is compared directly — a matching expression/` +
      `computed index, or moving the transformation to the constant side (e.g. a date range instead of wrapping ` +
      `the column in a truncation function) — usually restores index use.`,
  }
}

export const nonSargablePredicate: Rule = (node) => {
  const warnings: Warning[] = []

  const filterMatch = node.predicate?.filter ? findNonSargablePattern(node.predicate.filter) : undefined
  if (filterMatch) warnings.push(buildWarning(node, "filter", filterMatch))

  const joinMatch = node.predicate?.joinCondition ? findNonSargablePattern(node.predicate.joinCondition) : undefined
  if (joinMatch) warnings.push(buildWarning(node, "join condition", joinMatch))

  return warnings
}
