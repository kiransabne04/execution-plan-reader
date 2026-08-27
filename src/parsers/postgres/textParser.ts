// Story 1.2 — Parse plain `EXPLAIN ANALYZE` TEXT output (no FORMAT JSON) into
// the same internal PlanNode tree the JSON parser produces. See
// .claude/skills/postgres-plan-parsing/SKILL.md before editing.
//
// Tree shape comes from indentation + "->" markers, not fixed column
// positions: each child line is `<indent>-> <node header>`, and a node's own
// indent is however many leading whitespace characters preceded its "->" (or,
// for the root, however many preceded its header). Everything is relative —
// no assumption is made about indent width, so tab-prefixed captures
// (auto_explain) work the same as space-indented psql output.

import { PlanParseError, type PlanNode, type PlanNodeRole } from "../normalize"
import { cleanup } from "./cleanup"
import { derivePostgresExtendedFields } from "./extendedFields"
import { mapPostgresOperatorType } from "./operatorMap"

interface ParsedHeader {
  rawOperatorLabel: string
  operatorType: string
  estimatedRows?: number
  estimatedCost?: number
  actualTimeMs?: number
  actualRows?: number
  loops?: number
  attributes: Record<string, string>
}

interface StackEntry {
  indent: number
  node: PlanNode
}

const ARROW_LINE_RE = /^(\s*)->\s+(.+)$/
const CONTENT_LINE_RE = /^(\s*)(\S.*)$/
const DETAIL_KV_RE = /^([A-Za-z][\w ]*):\s?(.*)$/
const SUBPLAN_MARKER_RE = /^(InitPlan|SubPlan)\s+\d+/

export function parsePostgresTextPlan(rawInput: string): PlanNode {
  const cleaned = cleanup(rawInput)
  if (cleaned.length === 0) {
    throw new PlanParseError("EMPTY_INPUT", "Input is empty")
  }

  const lines = cleaned.split("\n")

  // A genuine EXPLAIN root line always carries a cost estimate — find the
  // first line that looks like one, and treat anything before it (an
  // auto_explain "duration: … plan:" preamble, a "Query Text:" line, etc.)
  // as ignorable preamble rather than plan content.
  const rootLineIndex = lines.findIndex((line) => line.includes("(cost="))
  if (rootLineIndex === -1) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like a Postgres text execution plan (no cost estimate found).",
    )
  }

  const planLines = lines.slice(rootLineIndex)
  assertNotTruncated(planLines[0], rootLineIndex + 1)

  const stack: StackEntry[] = []
  const counter = { next: 0 }
  let root: PlanNode | null = null
  let pendingSubplanMarker: { role: PlanNodeRole; text: string } | undefined

  for (let i = 0; i < planLines.length; i++) {
    const line = planLines[i]
    const lineNumber = rootLineIndex + i + 1

    const arrowMatch = line.match(ARROW_LINE_RE)
    if (arrowMatch) {
      const indent = arrowMatch[1].length
      const content = arrowMatch[2]
      assertNotTruncated(content, lineNumber)

      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }
      const parent = stack[stack.length - 1]?.node ?? root ?? undefined

      const header = parseNodeHeader(content)
      const role = pendingSubplanMarker?.role ?? "main"
      const node = makeNode(header, counter, role)
      if (pendingSubplanMarker) {
        node.attributes["Subplan Name"] = pendingSubplanMarker.text
        pendingSubplanMarker = undefined
      }

      if (parent) parent.children.push(node)
      stack.push({ indent, node })
      continue
    }

    const contentMatch = line.match(CONTENT_LINE_RE)
    if (!contentMatch) continue // defensive: cleanup() already drops blank lines
    const indent = contentMatch[1].length
    const text = contentMatch[2]

    if (!root) {
      const header = parseNodeHeader(text)
      root = makeNode(header, counter, "main")
      stack.push({ indent, node: root })
      continue
    }

    const subplanMatch = text.match(SUBPLAN_MARKER_RE)
    if (subplanMatch) {
      pendingSubplanMarker = {
        role: subplanMatch[1] === "InitPlan" ? "init" : "sub",
        text,
      }
      continue
    }

    const owner = ownerForDetailIndent(stack, indent) ?? root
    applyDetailLine(owner, text)
  }

  if (!root) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like a Postgres text execution plan.",
    )
  }

  // Detail lines (Filter:, Hash Cond:, Rows Removed by Filter:, ...) attach
  // to a node's attributes AFTER it's created (they're separate lines
  // following the header) — so the extended-field derivation has to run as
  // a post-pass over the finished tree, once every node's attributes bag
  // is actually complete, not at node-creation time.
  applyExtendedFieldsToTree(root)

  return root
}

function applyExtendedFieldsToTree(root: PlanNode): void {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    Object.assign(node, derivePostgresExtendedFields(node.attributes, node.actualTimeMs))
    stack.push(...node.children)
  }
}

/** A line with an opening "(cost=" but a mismatched paren count is a strong,
 * cheap signal of a paste that got cut off mid-line. Structural check only —
 * the error message never echoes the line's content. */
function assertNotTruncated(line: string, lineNumber: number): void {
  if (!line.includes("(cost=")) return
  const opens = (line.match(/\(/g) ?? []).length
  const closes = (line.match(/\)/g) ?? []).length
  if (opens !== closes) {
    throw new PlanParseError(
      "TRUNCATED_INPUT",
      `Line ${lineNumber} has unbalanced parentheses (looks like the paste got cut off).`,
    )
  }
}

function ownerForDetailIndent(stack: StackEntry[], indent: number): PlanNode | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].indent < indent) return stack[i].node
  }
  return stack[0]?.node
}

function applyDetailLine(owner: PlanNode, text: string): void {
  const m = text.match(DETAIL_KV_RE)
  if (!m) return // unrecognized detail line — best-effort; skip rather than crash
  const [, key, value] = m
  owner.attributes[key.trim()] = value.trim()
}

function makeNode(header: ParsedHeader, counter: { next: number }, role: PlanNodeRole): PlanNode {
  return {
    id: `n${counter.next++}`,
    engine: "postgres",
    operatorType: header.operatorType,
    rawOperatorLabel: header.rawOperatorLabel,
    estimatedRows: header.estimatedRows,
    actualRows: header.actualRows,
    estimatedCost: header.estimatedCost,
    actualTimeMs: header.actualTimeMs,
    loops: header.loops,
    role,
    children: [],
    attributes: { ...header.attributes },
    warnings: [],
  }
}

function parseNodeHeader(content: string): ParsedHeader {
  const costIdx = content.indexOf("(cost=")
  const labelPart = (costIdx === -1 ? content : content.slice(0, costIdx)).trim()
  const rest = costIdx === -1 ? "" : content.slice(costIdx)

  const { rawOperatorLabel, attributes } = parseLabel(labelPart)
  const operatorType = mapPostgresOperatorType(rawOperatorLabel)

  let estimatedRows: number | undefined
  let estimatedCost: number | undefined
  let actualTimeMs: number | undefined
  let actualRows: number | undefined
  let loops: number | undefined

  const costMatch = rest.match(/\(cost=([\d.,]+)\.\.([\d.,]+)\s+rows=(\d+)\s+width=(\d+)\)/)
  if (costMatch) {
    const startupCost = parseLocaleNumber(costMatch[1])
    estimatedCost = parseLocaleNumber(costMatch[2])
    estimatedRows = parseLocaleNumber(costMatch[3])
    if (startupCost !== undefined) attributes["Startup Cost"] = String(startupCost)
    attributes["Plan Width"] = costMatch[4]
  }

  const actualMatch = rest.match(/\(actual time=([\d.,]+)\.\.([\d.,]+)\s+rows=(\d+)\s+loops=(\d+)\)/)
  if (actualMatch) {
    const actualStartup = parseLocaleNumber(actualMatch[1])
    actualTimeMs = parseLocaleNumber(actualMatch[2])
    actualRows = parseLocaleNumber(actualMatch[3])
    loops = parseLocaleNumber(actualMatch[4])
    if (actualStartup !== undefined) attributes["Actual Startup Time"] = String(actualStartup)
  } else if (/\(never executed\)/.test(rest)) {
    attributes["Never Executed"] = "true"
  }

  return { rawOperatorLabel, operatorType, estimatedRows, estimatedCost, actualTimeMs, actualRows, loops, attributes }
}

/** Robust, not-position-dependent numeric parsing. Tolerates a European-style
 * locale-formatted number (`1.234,56`) that a copy/reformat step might have
 * introduced instead of Postgres's own plain `1234.56` — falls back to
 * `undefined` (never NaN) rather than silently misreading it. */
function parseLocaleNumber(token: string): number | undefined {
  const direct = Number(token)
  if (Number.isFinite(direct)) return direct

  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(token)) {
    const normalized = token.replace(/\./g, "").replace(",", ".")
    const value = Number(normalized)
    if (Number.isFinite(value)) return value
  }

  return undefined
}

interface ParsedLabel {
  rawOperatorLabel: string
  attributes: Record<string, string>
}

function stripQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, "$1")
}

const SCAN_LABEL_RE =
  /^(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan|Tid Scan|Subquery Scan|Function Scan|Values Scan|CTE Scan|Named Tuplestore Scan|WorkTable Scan|Foreign Scan|Custom Scan)(\s+Backward)?(?:\s+using\s+(\S+))?(?:\s+on\s+(\S+)(?:\s+(\S+))?)?$/

function parseScanLabel(label: string): ParsedLabel | null {
  const m = label.match(SCAN_LABEL_RE)
  if (!m) return null
  const [, nodeType, backward, indexName, onTarget, alias] = m
  const attributes: Record<string, string> = {}
  if (backward) attributes["Scan Direction"] = "Backward"
  if (indexName) attributes["Index Name"] = stripQuotes(indexName)
  if (onTarget) {
    if (nodeType === "Bitmap Index Scan" && !indexName) {
      attributes["Index Name"] = stripQuotes(onTarget)
    } else {
      attributes["Relation Name"] = stripQuotes(onTarget)
    }
  }
  if (alias) attributes["Alias"] = stripQuotes(alias)
  return { rawOperatorLabel: nodeType, attributes }
}

const JOIN_LABEL_RE = /^(Nested Loop|Hash|Merge)(\s+(Left|Right|Full|Semi|Anti))?\s+Join$/

function parseJoinLabel(label: string): ParsedLabel | null {
  if (label === "Nested Loop") {
    return { rawOperatorLabel: "Nested Loop", attributes: { "Join Type": "Inner" } }
  }
  const m = label.match(JOIN_LABEL_RE)
  if (!m) return null
  const [, base, , joinType] = m
  const rawOperatorLabel = base === "Nested Loop" ? "Nested Loop" : `${base} Join`
  return { rawOperatorLabel, attributes: { "Join Type": joinType ?? "Inner" } }
}

const MODIFY_TABLE_LABEL_RE = /^(Insert|Update|Delete|Merge)\s+on\s+(\S+)(?:\s+(\S+))?$/

function parseModifyTableLabel(label: string): ParsedLabel | null {
  const m = label.match(MODIFY_TABLE_LABEL_RE)
  if (!m) return null
  const [, verb, relation, alias] = m
  const attributes: Record<string, string> = {
    Operation: verb,
    "Relation Name": stripQuotes(relation),
  }
  if (alias) attributes["Alias"] = stripQuotes(alias)
  return { rawOperatorLabel: "ModifyTable", attributes }
}

function parseLabel(rawLabel: string): ParsedLabel {
  let label = rawLabel.trim()
  const attributes: Record<string, string> = {}

  const parallelMatch = label.match(/^Parallel\s+(.*)$/)
  if (parallelMatch) {
    attributes["Parallel Aware"] = "true"
    label = parallelMatch[1]
  }

  const scan = parseScanLabel(label)
  if (scan) return { rawOperatorLabel: scan.rawOperatorLabel, attributes: { ...attributes, ...scan.attributes } }

  const join = parseJoinLabel(label)
  if (join) return { rawOperatorLabel: join.rawOperatorLabel, attributes: { ...attributes, ...join.attributes } }

  const modify = parseModifyTableLabel(label)
  if (modify) return { rawOperatorLabel: modify.rawOperatorLabel, attributes: { ...attributes, ...modify.attributes } }

  // Everything else (Aggregate family, Sort, Limit, Append, Materialize,
  // Gather, Unique, SetOp, Group, Result, ProjectSet, Memoize, Lock Rows,
  // BitmapAnd, BitmapOr, Recursive Union, Merge Append, WindowAgg, …) prints
  // identically in TEXT and JSON — pass through as-is. An unrecognized label
  // still resolves to operatorType "unknown" rather than crashing (see the
  // plan-normalization skill's mapping-table contract).
  return { rawOperatorLabel: label, attributes }
}
