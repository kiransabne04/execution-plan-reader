// Shared number formatting for warning text. Always pins the locale
// explicitly — `.toLocaleString()` with no argument follows the runtime's
// default locale, which produces inconsistent digit grouping across
// machines (e.g. an en-IN default renders 490000 as "4,90,000") and makes
// output non-deterministic, which rule output must never be.
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US")
}
