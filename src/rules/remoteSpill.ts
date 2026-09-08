// Snowflake rule: remote-spill. `spill.bytesRemote` (Snowflake-specific —
// no Postgres/SQL Server distinction between local and remote spill
// storage; see `SpillInfo`'s own doc comment in normalize.ts) is data that
// didn't fit in memory AND didn't fit on the warehouse's own local SSD
// cache either — it went all the way to Snowflake's remote storage layer.
//
// This file's own explicit instruction: give this HIGHER severity than an
// equivalent small local spill. Remote storage round-trips are
// significantly more expensive than staying in memory or even local SSD —
// the same byte volume costs meaningfully more once it's crossed that
// boundary. Implemented via `snowflakeSpillDetail.ts`'s shared byte-
// severity function, parameterized with REMOTE's own lower thresholds
// (10MB/100MB vs. local's 100MB/1GB) — the same absolute byte count
// reliably lands at least one severity tier higher here than it would
// under `localSpill.ts`, by construction, not by coincidence.
//
// Coexists with the engine-agnostic `disk-spill` (unconditional critical)
// rather than replacing it — same layering established for SQL Server's
// own spill enrichment rules.
//
// "Do not directly recommend warehouse resize without context" (this
// file's own explicit instruction): `longText` names a bigger warehouse
// as ONE possible angle among several (row/column volume, join/aggregate
// strategy), never as THE prescribed fix — the same "co-equal angles,
// never singled out" framing `sqlServerHashSpill.ts` already uses for its
// own "don't blindly recommend memory" instruction.

import { bytesSeverity, bytesText, REMOTE_SPILL_CRITICAL_BYTES, REMOTE_SPILL_WARNING_BYTES } from "./snowflakeSpillDetail"
import type { Rule } from "./types"

export const remoteSpill: Rule = (node) => {
  if (node.engine !== "snowflake" || !node.spill?.occurred) return []

  const bytesRemote = node.spill.bytesRemote
  if (bytesRemote === undefined || !Number.isFinite(bytesRemote) || bytesRemote <= 0) return []

  const severity = bytesSeverity(bytesRemote, REMOTE_SPILL_WARNING_BYTES, REMOTE_SPILL_CRITICAL_BYTES)
  if (!severity) return []

  const bytesTextValue = bytesText(bytesRemote)

  return [
    {
      ruleId: "remote-spill",
      severity,
      shortText: `Spilled ${bytesTextValue} to remote storage — significantly more expensive than a local/in-memory spill of the same size.`,
      longText:
        `This ${node.rawOperatorLabel} spilled ${bytesTextValue} all the way to Snowflake's remote storage — it ` +
        `didn't fit in memory, and it didn't fit on the warehouse's own local SSD cache either. Remote storage ` +
        `round-trips are significantly more expensive than staying in memory or even local disk, so the same byte ` +
        `volume costs meaningfully more once it's crossed that boundary — this is why remote spill is flagged more ` +
        `severely here than an equivalent local spill would be. A larger warehouse (more memory and local cache) is ` +
        `one possible angle, but not automatically the right one — reducing the row/column volume feeding this ` +
        `operator, or a different join/aggregate strategy, can matter just as much; this plan alone can't say which ` +
        `applies without more context about the query and data.`,
      provenance: {
        threshold: `bytesRemote ≥ ${bytesText(REMOTE_SPILL_WARNING_BYTES)}${severity === "critical" ? ` (critical at ≥ ${bytesText(REMOTE_SPILL_CRITICAL_BYTES)})` : ""}`,
        computed: bytesTextValue,
      },
    },
  ]
}
