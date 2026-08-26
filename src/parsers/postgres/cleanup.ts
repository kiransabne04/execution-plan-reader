// Pre-processing pass that runs before the structural parser sees the text.
// Per .claude/skills/postgres-plan-parsing/SKILL.md rule #2, this must run
// always, not just for TEXT-format pastes — a JSON plan can still arrive
// with CRLF line endings, stray blank lines, or (when captured via
// auto_explain with FORMAT JSON) a leading LOG:/timestamp prefix.

/** Strips a leading auto_explain log prefix, e.g. `2024-01-01 12:00:00 UTC LOG:  ` */
const AUTO_EXPLAIN_PREFIX = /^.*?\bLOG:\s*/i

// `psql \x on` wraps every plan LINE in its own "-[ RECORD N ]-..." block,
// since EXPLAIN returns one row per plan line under a single QUERY PLAN
// column. These markers/column-name prefixes carry no structural meaning
// and must be stripped before the real parser (JSON or TEXT) sees the text.
const RECORD_MARKER_RE = /^-\[\s*RECORD\s+\d+\s*\]-*\s*$/
const XMODE_COLUMN_RE = /^\s*QUERY PLAN\s*\|\s?(.*)$/i

// Plain (non `-x`) psql output wraps the plan in a "QUERY PLAN" column
// header, a dashed underline, and a trailing "(N rows)" footer.
const HEADER_LINE_RE = /^\s*QUERY PLAN\s*$/i
const DASH_SEPARATOR_RE = /^\s*-{3,}\s*$/
const ROW_COUNT_FOOTER_RE = /^\s*\(\d+ rows?\)\s*$/i

export function cleanup(rawInput: string): string {
  // Normalize CRLF/CR to LF so downstream parsing never has to think about
  // line-ending variants (common when a plan is pasted from a Windows tool).
  const text = rawInput.replace(/\r\n?/g, "\n")

  const lines = text.split("\n")

  // Strip a single leading auto_explain log prefix, if present, on the first
  // non-blank line only — the JSON/plan payload itself is left untouched.
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIndex !== -1 && AUTO_EXPLAIN_PREFIX.test(lines[firstContentIndex])) {
    lines[firstContentIndex] = lines[firstContentIndex].replace(AUTO_EXPLAIN_PREFIX, "")
  }

  const unwrapped = lines
    .map((line) => {
      if (RECORD_MARKER_RE.test(line)) return ""
      const xmode = line.match(XMODE_COLUMN_RE)
      if (xmode) return xmode[1]
      if (HEADER_LINE_RE.test(line)) return ""
      if (DASH_SEPARATOR_RE.test(line)) return ""
      if (ROW_COUNT_FOOTER_RE.test(line)) return ""
      return line
    })
    // Drop blank lines outright: valid Postgres plan output (JSON or TEXT)
    // never carries meaning in a blank line, and dropping them here also
    // collapses any gaps left behind by the stripping above — common paste
    // artifact, not just a leading/trailing concern.
    .filter((line) => line.trim().length > 0)

  return unwrapped.join("\n").trim()
}
