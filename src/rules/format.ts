// Shared number formatting for warning text. Always pins the locale
// explicitly — `.toLocaleString()` with no argument follows the runtime's
// default locale, which produces inconsistent digit grouping across
// machines (e.g. an en-IN default renders 490000 as "4,90,000") and makes
// output non-deterministic, which rule output must never be.
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US")
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/**
 * A compact, human-scaled byte size ("84 MB", "1.5 GB") — deliberately
 * NOT what `diskSpill.ts`'s own prose uses (`describeSpill`'s exact byte
 * counts, e.g. "88,080,384 bytes to local disk"): that precision is right
 * for a sentence explaining what happened, but far too verbose for the
 * node card's compact pill badge (spec §3's badge table: "spill size").
 * Binary (1024-based) scaling, matching the common casual "MB" usage this
 * app's own audience expects, not a strict decimal/binary distinction.
 */
export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B" // never NaN/Infinity in the output — an honest floor, not a guess
  if (bytes < 1024) return `${Math.round(Math.max(0, bytes))} B`
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${BYTE_UNITS[unitIndex]}`
}
