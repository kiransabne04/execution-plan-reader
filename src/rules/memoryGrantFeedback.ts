// SQL Server rule: memory-grant-feedback. SQL Server 2017+'s Memory Grant
// Feedback feature can adjust a query's memory grant between executions
// based on what earlier runs actually used, and (on builds that expose it)
// records whether/how that happened via an `IsMemoryGrantFeedbackAdjusted`
// marker. This rule surfaces that marker purely as INFORMATION when it's
// actually present in the parsed plan — never as a diagnosis of its own.
//
// This session could not verify, against an authoritative schema
// reference or a real captured plan, exactly which Showplan XML element
// carries this attribute in practice — `parseShowplanXml.ts` checks both
// plausible locations (the `MemoryGrantInfo` element itself, and the
// `QueryPlan` root) defensively, and `root.memoryGrant.feedbackAdjusted`
// is ONLY ever set when the attribute is genuinely found in the input.
// This rule inherits that same honesty: it never fires, and never
// mentions feedback at all, on a plan where the marker isn't present —
// there is no inferred or default feedback state. Every known raw value
// this rule recognizes is mapped to a plain-language explanation; an
// unrecognized value (a future SQL Server build's own new state) is still
// shown, verbatim, rather than silently dropped or guessed at.

import type { Rule } from "./types"

// Values documented in Microsoft's own Memory Grant Feedback material —
// mapped to plain language where confidently known. Not exhaustive by
// construction (see this file's header comment): an unrecognized raw
// value still gets surfaced, just without a friendly explanation attached.
const KNOWN_VALUES: Record<string, string> = {
  YesStable: "the grant has been adjusted by feedback from earlier runs and has stabilized — it isn't expected to change further on its own",
  YesAdjusting: "the grant was adjusted by feedback from an earlier run and may still be actively adjusting on subsequent executions",
  NoFirstExecution: "this was the plan's first execution, so there's no earlier run's usage to base a feedback adjustment on yet",
  NoFeedback: "feedback didn't adjust anything on this execution",
}

export const memoryGrantFeedback: Rule = (node, context) => {
  if (node.engine !== "sqlserver" || node.id !== context.rootId) return [] // whole-query fact, surfaced once

  const raw = node.memoryGrant?.feedbackAdjusted
  if (!raw) return []

  const known = KNOWN_VALUES[raw]
  const explanation = known ?? `SQL Server reported this as "${raw}" — this app doesn't have a plain-language explanation for that specific value yet, so it's shown as-is rather than guessed at.`

  return [
    {
      ruleId: "memory-grant-feedback",
      severity: "info",
      shortText: `Memory grant feedback: ${raw}.`,
      longText:
        `This plan carries a Memory Grant Feedback marker from SQL Server: "${raw}". ${explanation} This is purely ` +
        `informational — Memory Grant Feedback is a real SQL Server mechanism, not a diagnosis this app is making; ` +
        `it doesn't say whether the CURRENT grant is well-sized, only that the feedback mechanism has (or hasn't) ` +
        `acted on this query's plan.`,
      provenance: {
        threshold: "IsMemoryGrantFeedbackAdjusted attribute present anywhere this parser checks for it",
        computed: raw,
      },
    },
  ]
}
