// SQL Server rule: execution-mode. `ActualExecutionMode` is a real
// Showplan XML `RelOp` attribute (values `"Row"` or `"Batch"`) — already
// captured with no extra parser work, since `buildNode`'s generic
// attribute pass-through copies every RelOp attribute not otherwise
// promoted (see `PROMOTED_RELOP_ATTRS` in `parseShowplanXml.ts`) straight
// into `attributes` verbatim.
//
// Only surfaces the BATCH mode case, not row mode — row mode is the
// ordinary default for most operators in most plans, and flagging every
// single row-mode node would be pure noise, not information. Batch mode
// (processing rows in vectorized batches rather than one at a time,
// typically tied to columnstore indexes/aggregates) is the less common,
// more interesting case worth naming when present.
//
// This file's own explicit instruction: mostly informational, and no
// warning severity until real benchmark evidence justifies one — this
// rule never escalates beyond `info`, and never claims batch mode is
// better or worse than row mode for the specific query it's seen on.

import type { Rule } from "./types"

export const executionMode: Rule = (node) => {
  if (node.engine !== "sqlserver") return []

  const mode = node.attributes["ActualExecutionMode"]
  if (mode !== "Batch") return []

  return [
    {
      ruleId: "execution-mode",
      severity: "info",
      shortText: `This ${node.rawOperatorLabel} executed in Batch mode.`,
      longText:
        `This ${node.rawOperatorLabel} ran in Batch execution mode — SQL Server processed rows in vectorized ` +
        `batches rather than one row at a time, typically tied to columnstore indexes or batch-mode-capable ` +
        `aggregates/joins. This is purely informational: batch mode is generally more efficient for large scans and ` +
        `aggregations, but this app doesn't yet have benchmark evidence tying a specific execution-mode pattern to ` +
        `a performance verdict for your workload, so no warning is raised here — just the fact that it happened.`,
      provenance: {
        threshold: "ActualExecutionMode === \"Batch\"",
        computed: "Batch",
      },
    },
  ]
}
