// Small shared helpers for tolerant field access. Snowflake's operator-stats
// output has no single canonical casing/shape across GET_QUERY_OPERATOR_STATS
// output vs. exported Query Profile JSON vs. a copy-pasted result-grid
// export — see .claude/skills/snowflake-plan-parsing/SKILL.md.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Case-insensitive, alias-tolerant field lookup (e.g. `id`/`operator_id`/`OPERATOR_ID`). */
export function getField(obj: Record<string, unknown>, ...aliases: string[]): unknown {
  const byLowerCase = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]))
  for (const alias of aliases) {
    const actualKey = byLowerCase.get(alias.toLowerCase())
    if (actualKey !== undefined) return obj[actualKey]
  }
  return undefined
}

/** A grid/CSV-style export often stringifies variant/array columns. Coerce a
 * JSON-object-shaped string back into an object; otherwise wrap whatever we
 * got so nothing is silently dropped. */
export function coerceRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (isRecord(parsed)) return parsed
    } catch {
      // not JSON — fall through
    }
    return value.length > 0 ? { raw: value } : {}
  }
  return {}
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Attributes bag only holds string|number — non-primitive raw values are
 * preserved as JSON strings rather than dropped. */
export function toAttributeValue(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}
