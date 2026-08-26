// Pre-processing pass that runs before the structural parser sees the text.
// Per .claude/skills/postgres-plan-parsing/SKILL.md rule #2, this must run
// always, not just for TEXT-format pastes — a JSON plan can still arrive
// with CRLF line endings, stray blank lines, or (when captured via
// auto_explain with FORMAT JSON) a leading LOG:/timestamp prefix.

/** Strips a leading auto_explain log prefix, e.g. `2024-01-01 12:00:00 UTC LOG:  ` */
const AUTO_EXPLAIN_PREFIX = /^.*?\bLOG:\s*/i

export function cleanup(rawInput: string): string {
  let text = rawInput

  // Normalize CRLF/CR to LF so downstream parsing never has to think about
  // line-ending variants (common when a plan is pasted from a Windows tool).
  text = text.replace(/\r\n?/g, "\n")

  // Strip a single leading auto_explain log prefix, if present, on the first
  // non-blank line only — the JSON/plan payload itself is left untouched.
  const lines = text.split("\n")
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIndex !== -1 && AUTO_EXPLAIN_PREFIX.test(lines[firstContentIndex])) {
    lines[firstContentIndex] = lines[firstContentIndex].replace(AUTO_EXPLAIN_PREFIX, "")
  }
  text = lines.join("\n")

  // Trim leading/trailing whitespace and blank lines (common paste artifact).
  text = text.trim()

  return text
}
