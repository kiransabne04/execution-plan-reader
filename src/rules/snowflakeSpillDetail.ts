// Shared machinery between `remoteSpill.ts` and `localSpill.ts` — both
// scale severity by bytes spilled, but REMOTE spill escalates at a lower
// byte count than local spill (Story 31.1's own explicit instruction:
// "give higher severity than an equivalent small local spill") — one
// shared byte-severity function, parameterized by which storage tier,
// rather than two independently-tuned copies that could drift apart from
// each other's relative severity by accident.
//
// Both coexist with the engine-agnostic `disk-spill` (unconditional,
// always `critical` the moment `spill.occurred` is true) rather than
// replacing it — same layering `sqlServerSortSpill.ts`/`sqlServerHashSpill.ts`
// already established for SQL Server's own spill enrichment.

import { formatBytesCompact } from "./format"

/** Local spill severity floors (bytes). */
export const LOCAL_SPILL_WARNING_BYTES = 100 * 1024 * 1024 // 100 MB
export const LOCAL_SPILL_CRITICAL_BYTES = 1024 * 1024 * 1024 // 1 GB

/** Remote spill escalates at a LOWER byte count than local — the same
 * absolute volume is judged more severe once it's gone all the way to
 * remote storage (this file's own header comment explains why). */
export const REMOTE_SPILL_WARNING_BYTES = 10 * 1024 * 1024 // 10 MB
export const REMOTE_SPILL_CRITICAL_BYTES = 100 * 1024 * 1024 // 100 MB

export function bytesSeverity(bytes: number, warningFloor: number, criticalFloor: number): "warning" | "critical" | undefined {
  if (bytes < warningFloor) return undefined
  return bytes >= criticalFloor ? "critical" : "warning"
}

export function bytesText(bytes: number): string {
  return formatBytesCompact(bytes)
}
