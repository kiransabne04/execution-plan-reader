// SQL Server rule: adaptive-join. SQL Server 2017+'s Adaptive Join defers
// choosing between a Nested Loop and a Hash Match until it sees the actual
// row count of the build input at runtime — only ONE of its two candidate
// children actually executes.
//
// "Which branch executed" is determined here purely from real execution
// evidence already on each child (`actualRows`/`loops`/`actualTimeMs`
// present on one child but not the other) — NOT from a specific named
// Showplan XML attribute this session could not verify against an
// authoritative schema reference (real Adaptive Join plans may carry an
// attribute naming the chosen branch directly, but this parser doesn't
// assume one exists or guess its name). When both children show real
// execution data, or neither does (an estimate-only plan), this rule
// states the story's own required fallback sentence verbatim rather than
// guessing which side "really" ran.

import type { PlanNode } from "../parsers/normalize"
import type { Rule } from "./types"

function hasExecutionEvidence(child: PlanNode): boolean {
  return (
    (child.actualRows !== undefined && Number.isFinite(child.actualRows)) ||
    (child.loops !== undefined && Number.isFinite(child.loops)) ||
    (child.actualTimeMs !== undefined && Number.isFinite(child.actualTimeMs))
  )
}

export const CANNOT_CONFIRM_BRANCH_TEXT =
  "Showplan does not provide enough evidence here to confirm which branch dominated."

export const adaptiveJoin: Rule = (node) => {
  if (node.engine !== "sqlserver" || node.operatorType !== "adaptive_join") return []

  const [first, second] = node.children
  const firstRan = first ? hasExecutionEvidence(first) : false
  const secondRan = second ? hasExecutionEvidence(second) : false

  let branchNote: string
  if (first && second && firstRan !== secondRan) {
    const executed = firstRan ? first : second
    branchNote = `Based on which of this node's two candidate branches actually shows real execution data, it looks like the ${executed.rawOperatorLabel} branch is the one that ran.`
  } else {
    branchNote = CANNOT_CONFIRM_BRANCH_TEXT
  }

  return [
    {
      ruleId: "adaptive-join",
      severity: "info",
      shortText: `Adaptive Join — SQL Server chose between a Nested Loop and a Hash Match at runtime.`,
      longText:
        `This is an Adaptive Join: SQL Server compiled two candidate join strategies (typically a Nested Loop and a ` +
        `Hash Match) and deferred the choice until it saw the actual row count of the build input at execution ` +
        `time, rather than committing to one at compile time. Only one of the two candidate branches actually ` +
        `executes. ${branchNote} This is purely informational — an Adaptive Join isn't itself a problem; it's the ` +
        `optimizer hedging against a build input whose real size was uncertain at compile time.`,
      provenance: {
        threshold: "operatorType === adaptive_join (SQL Server PhysicalOp \"Adaptive Join\")",
        computed: branchNote,
      },
    },
  ]
}
