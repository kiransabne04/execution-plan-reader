// MVP rule 3: disk spill. Detection itself is engine-specific (see
// .claude/skills/rule-engine-authoring/SKILL.md and
// docs/10-node-stats-field-catalog.md §6), but that complexity now lives
// entirely in each parser, which promotes it to the one normalized
// `PlanNode.spill` field — exactly so this rule, and anything else that
// needs the signal, has a single consistent thing to check regardless of
// how buried or explicit the underlying engine's own signal is.

import type { SpillInfo } from "../parsers/normalize"
import { formatNumber } from "./format"
import type { Rule } from "./types"

function describeSpill(spill: SpillInfo): string {
  const parts: string[] = []
  if (spill.bytesLocal !== undefined && spill.bytesLocal > 0) {
    parts.push(`${formatNumber(spill.bytesLocal)} bytes to local disk`)
  }
  if (spill.bytesRemote !== undefined && spill.bytesRemote > 0) {
    parts.push(`${formatNumber(spill.bytesRemote)} bytes to remote disk`)
  }
  if (parts.length > 0) return parts.join(", ")
  return spill.detail ?? "to disk"
}

export const diskSpill: Rule = (node) => {
  if (!node.spill?.occurred) return []

  const detail = describeSpill(node.spill)

  return [
    {
      ruleId: "disk-spill",
      severity: "critical",
      shortText: `Spilled ${detail} — ran out of memory for this operation.`,
      longText:
        `This ${node.rawOperatorLabel} operation didn't fit in the memory it was given and spilled ${detail}. ` +
        `Disk is far slower than memory, so this is usually a significant and fixable cost — increasing available memory ` +
        `(work_mem on Postgres, the memory grant on SQL Server, a bigger warehouse on Snowflake) or reducing the row/column ` +
        `volume feeding this operator are the usual fixes.`,
    },
  ]
}
