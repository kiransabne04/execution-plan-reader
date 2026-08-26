// The parameter-sensitivity honesty rule (see
// .claude/skills/rule-engine-authoring/SKILL.md and docs/prd.md non-goals).
// A single pasted plan is one snapshot of one execution — it cannot, by
// construction, diagnose parameter sniffing or plan instability. This rule
// does NOT attempt that diagnosis; it only checks for a directly observable
// fact (the statement text contains a parameter marker, or a node
// references an InitPlan/SubPlan-computed value) and attaches a disclosure
// note, never a "this IS parameter sniffing" claim.

import type { PlanNode } from "../parsers/normalize"
import type { Rule } from "./types"

const HONESTY_NOTE =
  "This reflects one specific run — if this query is sometimes fast and sometimes slow, a different plan may be " +
  "used for different input values, which a single pasted plan can't show you."

const SQLSERVER_PARAM_MARKER_RE = /@\w+/
const POSTGRES_PARAM_PLACEHOLDER_RE = /\$\d+/

export const parameterSensitivityNote: Rule = (node, context) => {
  if (node.id !== context.rootId) return [] // whole-plan-level disclosure, surfaced once

  const signalFound =
    (context.engine === "sqlserver" &&
      context.statementText !== undefined &&
      SQLSERVER_PARAM_MARKER_RE.test(context.statementText)) ||
    (context.engine === "postgres" && subtreeHasPostgresParamPlaceholder(node))

  if (!signalFound) return []

  return [
    {
      ruleId: "parameter-sensitivity-honesty-note",
      severity: "info",
      shortText: "This query uses parameters — a single run's plan may not represent every input.",
      longText: HONESTY_NOTE,
    },
  ]
}

function subtreeHasPostgresParamPlaceholder(node: PlanNode): boolean {
  for (const value of Object.values(node.attributes)) {
    if (typeof value === "string" && POSTGRES_PARAM_PLACEHOLDER_RE.test(value)) return true
  }
  return node.children.some(subtreeHasPostgresParamPlaceholder)
}
