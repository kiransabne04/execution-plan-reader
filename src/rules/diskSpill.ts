// MVP rule 3: disk spill. Works differently per engine — see
// .claude/skills/rule-engine-authoring/SKILL.md ("works differently per
// engine") — so detection is engine-specific, reading whichever attribute
// each parser already promoted for exactly this purpose:
//   - Postgres: Sort Space Type === "Disk" (Sort), or Disk Usage > 0 (Hash)
//   - SQL Server: Spill Occurred === "true" (Warnings/SpillOccurred)
//   - Snowflake: Spilled To Local/Remote Storage (already promoted in the parser)

import type { PlanNode } from "../parsers/normalize"
import { formatNumber } from "./format"
import type { Rule } from "./types"

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

interface SpillDetection {
  detected: boolean
  detail?: string
}

function detectSpill(node: PlanNode): SpillDetection {
  switch (node.engine) {
    case "postgres": {
      if (node.attributes["Sort Space Type"] === "Disk") {
        const kb = toFiniteNumber(node.attributes["Sort Space Used"])
        return { detected: true, detail: kb !== undefined ? `${formatNumber(kb)} KB to disk (external sort)` : "to disk (external sort)" }
      }
      const diskUsage = node.operatorType === "hash" ? toFiniteNumber(node.attributes["Disk Usage"]) : undefined
      if (diskUsage !== undefined && diskUsage > 0) {
        return { detected: true, detail: `${formatNumber(diskUsage)} KB to disk (hash)` }
      }
      return { detected: false }
    }
    case "sqlserver": {
      if (node.attributes["Spill Occurred"] === "true") {
        return { detected: true, detail: "to tempdb" }
      }
      return { detected: false }
    }
    case "snowflake": {
      const local = toFiniteNumber(node.attributes["Spilled To Local Storage"])
      const remote = toFiniteNumber(node.attributes["Spilled To Remote Storage"])
      const parts: string[] = []
      if (local !== undefined && local > 0) parts.push(`${formatNumber(local)} bytes to local disk`)
      if (remote !== undefined && remote > 0) parts.push(`${formatNumber(remote)} bytes to remote disk`)
      return parts.length > 0 ? { detected: true, detail: parts.join(", ") } : { detected: false }
    }
    default:
      return { detected: false }
  }
}

export const diskSpill: Rule = (node) => {
  const { detected, detail } = detectSpill(node)
  if (!detected) return []

  return [
    {
      ruleId: "disk-spill",
      severity: "critical",
      shortText: `Spilled ${detail ?? "to disk"} — ran out of memory for this operation.`,
      longText:
        `This ${node.rawOperatorLabel} operation didn't fit in the memory it was given and spilled ${detail ?? "to disk"}. ` +
        `Disk is far slower than memory, so this is usually a significant and fixable cost — increasing available memory ` +
        `(work_mem on Postgres, the memory grant on SQL Server, a bigger warehouse on Snowflake) or reducing the row/column ` +
        `volume feeding this operator are the usual fixes.`,
    },
  ]
}
