// SQL Server rule: implicit-conversion. `CONVERT_IMPLICIT(target_type, expr,
// style)` in a plan's predicate text means SQL Server converted `expr` to
// `target_type` at runtime to make a comparison possible — the column and
// whatever it's compared against (a parameter, literal, or another column)
// don't share a declared type. Checked in three places, per node:
//
// - `predicate.indexCondition` (a Seek Predicate) — this text alone PROVES
//   an index seek happened here (the conversion did not, in this case,
//   prevent one) — see `nonSargablePredicate.ts`'s own precedent for why
//   that matters: a pattern found here can't be blamed for "no seek"
//   symptoms the way one in a residual filter can.
// - `predicate.filter` (a residual Predicate) — evaluated per row AFTER
//   whatever narrowing already happened; a conversion here couldn't be
//   part of a seek/index condition at all.
// - `attributes["Join Key Implicit Conversion"]` — a Hash Match's own
//   build/probe join key needing a conversion (see `parseShowplanXml.ts`'s
//   `extractJoinKeysText`) — promoted to an attribute rather than
//   `predicate.joinCondition` (shown to users verbatim elsewhere, must stay
//   an honest clean condition string, not a raw key-list concatenation).
//
// Deliberately NOT graded as an absolute "this is broken": the story's own
// explicit instruction is to never claim every conversion prevents an
// index seek. Severity distinguishes "found only where a seek still
// happened" (info — worth knowing, low confidence of real impact) from
// "found in a residual filter or join key" (warning — a more concrete
// signal of degraded index access, skewed estimates, and per-row CPU
// overhead) — never critical, since this is a syntactic pattern match on
// free text, the same confidence ceiling `nonSargablePredicate.ts` already
// settled on for a structurally similar finding.
//
// Source type is intentionally never claimed: `CONVERT_IMPLICIT`'s own
// Showplan syntax names only the TARGET type and the expression being
// converted — the original (source) type isn't present in the plan text
// at all, so "where possible" means "never," and this rule says so
// explicitly rather than guessing.

import type { Warning } from "../parsers/normalize"
import type { Rule } from "./types"

const CONVERT_IMPLICIT_PATTERN = /CONVERT_IMPLICIT\(\s*([^,()]+(?:\([^)]*\))?)\s*,\s*([^,]+?)\s*,\s*\d+\s*\)/g

export interface ConvertImplicitMatch {
  /** The type SQL Server converted TO — always present, it's the
   * function's own first argument. */
  targetType: string
  /** The expression that got converted (a column reference, parameter, or
   * literal) — whatever SQL Server printed as the second argument. */
  expression: string
}

/** Pure text scan for `CONVERT_IMPLICIT(...)` occurrences — exported so the
 * regex itself (and its "no source type" limitation) is independently
 * testable without going through a full `PlanNode`. */
export function findConvertImplicitConversions(text: string): ConvertImplicitMatch[] {
  const matches: ConvertImplicitMatch[] = []
  for (const m of text.matchAll(CONVERT_IMPLICIT_PATTERN)) {
    matches.push({ targetType: m[1].trim(), expression: m[2].trim() })
  }
  return matches
}

type LocationLabel = "seek predicate" | "residual predicate" | "join key"

interface LocationFinding {
  label: LocationLabel
  conversions: ConvertImplicitMatch[]
}

function describeConversions(conversions: ConvertImplicitMatch[]): string {
  // Dedup identical (expression, targetType) pairs — the same conversion
  // can legitimately appear twice in a composite seek predicate's text.
  const seen = new Set<string>()
  const parts: string[] = []
  for (const c of conversions) {
    const key = `${c.expression}→${c.targetType}`
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(`${c.expression} → ${c.targetType}`)
  }
  return parts.join(", ")
}

export const implicitConversion: Rule = (node) => {
  if (node.engine !== "sqlserver") return []

  const candidates: { label: LocationLabel; text: string | undefined }[] = [
    { label: "seek predicate", text: node.predicate?.indexCondition },
    { label: "residual predicate", text: node.predicate?.filter },
    { label: "join key", text: typeof node.attributes["Join Key Implicit Conversion"] === "string" ? (node.attributes["Join Key Implicit Conversion"] as string) : undefined },
  ]

  const findings: LocationFinding[] = candidates
    .filter((c): c is { label: LocationLabel; text: string } => c.text !== undefined)
    .map((c) => ({ label: c.label, conversions: findConvertImplicitConversions(c.text) }))
    .filter((f) => f.conversions.length > 0)

  if (findings.length === 0) return []

  // A conversion found ONLY inside a seek predicate is the lower-confidence
  // case (a seek demonstrably still happened) — anything in a residual
  // filter or join key escalates to `warning` since that's real evidence
  // of per-row filtering/join-key work outside an index's own narrowing.
  const onlyInSeekPredicate = findings.every((f) => f.label === "seek predicate")
  const severity: Warning["severity"] = onlyInSeekPredicate ? "info" : "warning"

  const locationLabels = [...new Set(findings.map((f) => f.label))]
  const locationText = locationLabels.join(locationLabels.length > 1 ? " and " : "")
  const conversionText = describeConversions(findings.flatMap((f) => f.conversions))

  const impactNote = onlyInSeekPredicate
    ? `This particular conversion sits inside a seek predicate that DID produce an index seek, so it hasn't ` +
      `prevented one here — but it's still worth knowing about: implicit conversions add a small amount of CPU ` +
      `overhead per comparison, and can skew the optimizer's row-count estimate for this condition, since it isn't ` +
      `reasoning about the column's real, un-converted value distribution.`
    : `This is a well-known cause of index access degradation — a converted expression often can't be matched ` +
      `against an index's stored (un-converted) values at all, which is consistent with it showing up outside a ` +
      `seek here. It's also a common source of cardinality-estimate error, since the optimizer estimates ` +
      `selectivity on the converted value rather than the column's actual stored distribution, and it adds real ` +
      `CPU overhead evaluating the conversion for every row (or every join key) it touches.`

  return [
    {
      ruleId: "implicit-conversion",
      severity,
      shortText: `Implicit type conversion (CONVERT_IMPLICIT) in this ${node.rawOperatorLabel}'s ${locationText} (${conversionText}).`,
      longText:
        `SQL Server inserted an implicit conversion (CONVERT_IMPLICIT) while evaluating this ${node.rawOperatorLabel}'s ` +
        `${locationText} — converting ${conversionText}. This usually means the column and whatever it's being ` +
        `compared against (a parameter, literal, or another column) don't share the same declared data type, so ` +
        `SQL Server converts one side at query time to make the comparison possible. ${impactNote} Not every ` +
        `implicit conversion prevents an index seek or causes a real problem — some are cheap and harmless (e.g. ` +
        `widening an int to a bigint) — this is worth investigating, not a guaranteed defect. The plan text doesn't ` +
        `show the column's own original declared type, only what it was converted TO — checking the actual table ` +
        `schema against the parameter/literal type used in the query is the way to confirm a real mismatch and ` +
        `decide whether to fix it at the query or schema level.`,
      provenance: {
        threshold: "predicate/seek-predicate/join-key text contains CONVERT_IMPLICIT(...)",
        computed: conversionText,
      },
    },
  ]
}
