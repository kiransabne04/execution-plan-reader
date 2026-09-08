// Snowflake rule: local-spill. `spill.bytesLocal` — data that didn't fit
// in memory but stayed on the warehouse's own local SSD cache (Snowflake's
// own tier below memory, above remote storage — see `remoteSpill.ts`'s
// own header comment for the fuller distinction). Scaled by bytes, using
// the SAME shared severity function `remoteSpill.ts` uses, but with
// local's own higher thresholds — the same byte count that fires
// `critical` here would already have fired `critical` under
// `remoteSpill.ts` at a tenth the volume, by design (Story 31.1's own
// "higher severity than an equivalent small local spill" instruction).
//
// Coexists with the engine-agnostic `disk-spill` (unconditional critical)
// rather than replacing it.

import { bytesSeverity, bytesText, LOCAL_SPILL_CRITICAL_BYTES, LOCAL_SPILL_WARNING_BYTES } from "./snowflakeSpillDetail"
import type { Rule } from "./types"

export const localSpill: Rule = (node) => {
  if (node.engine !== "snowflake" || !node.spill?.occurred) return []

  const bytesLocal = node.spill.bytesLocal
  if (bytesLocal === undefined || !Number.isFinite(bytesLocal) || bytesLocal <= 0) return []

  const severity = bytesSeverity(bytesLocal, LOCAL_SPILL_WARNING_BYTES, LOCAL_SPILL_CRITICAL_BYTES)
  if (!severity) return []

  const bytesTextValue = bytesText(bytesLocal)

  return [
    {
      ruleId: "local-spill",
      severity,
      shortText: `Spilled ${bytesTextValue} to local storage.`,
      longText:
        `This ${node.rawOperatorLabel} spilled ${bytesTextValue} to the warehouse's own local SSD cache — it didn't ` +
        `fit in the memory allotted for this operation. Local spill is real disk I/O and slower than staying in ` +
        `memory, but it's still meaningfully cheaper than spilling further out to remote storage (see this app's ` +
        `own remote-spill finding, which fires at a lower byte threshold specifically because that boundary costs ` +
        `more). A larger warehouse, or reducing the row/column volume feeding this operator, are the usual angles — ` +
        `this plan alone can't say which applies without more context about the query and data.`,
      provenance: {
        threshold: `bytesLocal ≥ ${bytesText(LOCAL_SPILL_WARNING_BYTES)}${severity === "critical" ? ` (critical at ≥ ${bytesText(LOCAL_SPILL_CRITICAL_BYTES)})` : ""}`,
        computed: bytesTextValue,
      },
    },
  ]
}
