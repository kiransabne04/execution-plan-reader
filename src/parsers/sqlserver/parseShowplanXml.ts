// Story 2.1 — Parse SQL Server Showplan XML (`.sqlplan` file or pasted XML)
// into the internal PlanNode model. See
// .claude/skills/sqlserver-plan-parsing/SKILL.md before editing.
//
// Uses the browser-native DOMParser (available in the browser and in the
// jsdom test environment) rather than any XML library dependency — this
// parser is pure DOM traversal by `localName`, which is namespace-prefix-
// agnostic by construction: `xmlns="..."` and `xmlns:p="..."` both resolve
// to the same `localName` on each element, so no special-casing is needed
// for either declaration style.
//
// Both a raw `.sqlplan` file's contents and pasted XML text are just strings
// by the time they reach this function — file-vs-paste is a UI-layer
// concern, not a parser one.

import { PlanParseError, type PlanNode, type PlanNodeRole } from "../normalize"
import { mapSqlServerOperatorType } from "./operatorMap"

export interface MissingIndexRecommendation {
  impact?: number
  database?: string
  schema?: string
  table?: string
  equalityColumns: string[]
  inequalityColumns: string[]
  includedColumns: string[]
}

// A single paste can contain multiple statements (Episode 2 edge case) — the
// engine-agnostic PlanNode contract has no room for that, so SQL Server's
// parser returns its own small wrapper rather than a bare PlanNode. This is
// an engine-specific extension, not a change to the shared contract.
export interface SqlServerStatementPlan {
  statementText?: string
  statementId?: string
  root: PlanNode
  missingIndexes: MissingIndexRecommendation[]
}

export interface SqlServerParseResult {
  statements: SqlServerStatementPlan[]
}

export function parseSqlServerShowplanXml(rawInput: string): SqlServerParseResult {
  const cleaned = rawInput.trim()
  if (cleaned.length === 0) {
    throw new PlanParseError("EMPTY_INPUT", "Input is empty")
  }
  if (!cleaned.endsWith(">")) {
    throw new PlanParseError(
      "TRUNCATED_INPUT",
      "This XML looks like it got cut off (doesn't end with a closing tag).",
    )
  }

  const doc = parseXmlDocument(cleaned)

  // Non-negotiable rule: never assume ShowPlanXML is the document root —
  // Extended Events capture wraps it in additional XML. Search for it
  // wherever it appears.
  const showPlanEl = findFirstByLocalName(doc, "ShowPlanXML")
  if (!showPlanEl) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like a SQL Server Showplan XML execution plan (no ShowPlanXML element found).",
    )
  }

  const candidates = findAllStatementElements(showPlanEl)
    .map((stmtEl) => ({ stmtEl, queryPlanEl: findDirectOrNearestQueryPlan(stmtEl) }))
    .filter((c): c is { stmtEl: Element; queryPlanEl: Element } => c.queryPlanEl !== null)

  if (candidates.length === 0) {
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like a SQL Server Showplan XML execution plan (no statement/QueryPlan found).",
    )
  }

  const statements: SqlServerStatementPlan[] = candidates.map(({ stmtEl, queryPlanEl }) => {
    const rootRelOps = findChildRelOps(queryPlanEl)
    if (rootRelOps.length === 0) {
      throw new PlanParseError("NOT_A_PLAN", "A statement's QueryPlan has no RelOp tree.")
    }
    const counter = { next: 0 }
    const root = buildNode(rootRelOps[0], counter, "main")
    return {
      statementText: stmtEl.getAttribute("StatementText") ?? undefined,
      statementId: stmtEl.getAttribute("StatementId") ?? undefined,
      root,
      missingIndexes: parseMissingIndexes(stmtEl),
    }
  })

  return { statements }
}

function parseXmlDocument(xmlText: string): Document {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml")
  } catch {
    throw new PlanParseError("INVALID_XML", "Failed to parse XML input.")
  }
  if (findFirstByLocalName(doc, "parsererror")) {
    throw new PlanParseError(
      "INVALID_XML",
      "This XML looks malformed or incomplete (the XML parser rejected it).",
    )
  }
  return doc
}

// ---- DOM helpers (namespace-agnostic: always match by localName) ----

function localName(el: Element): string {
  return el.localName ?? el.tagName
}

function findFirstByLocalName(root: Document | Element, name: string): Element | null {
  const rootEl = root instanceof Document ? root.documentElement : root
  if (!rootEl) return null
  if (localName(rootEl) === name) return rootEl
  for (const child of Array.from(rootEl.children)) {
    const found = findFirstByLocalName(child, name)
    if (found) return found
  }
  return null
}

function findAllByLocalName(root: Element, name: string): Element[] {
  const results: Element[] = []
  const walk = (el: Element) => {
    if (localName(el) === name) results.push(el)
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)
  return results
}

function findDirectChild(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => localName(c) === name)
}

/** Nearest descendant with the given name, without crossing into a nested
 * RelOp's own subtree — used for elements (like `Object`) that live inside
 * an operator's detail wrapper, one or more levels below the RelOp, but
 * belong to THIS operator, not one of its children. */
function findNearestDescendant(el: Element, name: string): Element | undefined {
  for (const child of Array.from(el.children)) {
    if (localName(child) === name) return child
    if (localName(child) !== "RelOp") {
      const found = findNearestDescendant(child, name)
      if (found) return found
    }
  }
  return undefined
}

/** A RelOp's children live inside an operator-specific wrapper element
 * (`<NestedLoops>`, `<Hash>`, ...), not directly under the RelOp itself.
 * Collect the nearest RelOp elements without crossing into a found RelOp's
 * own subtree (that would pick up grandchildren, not children). */
function findChildRelOps(el: Element): Element[] {
  const result: Element[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (localName(child) === "RelOp") {
        result.push(child)
      } else {
        walk(child)
      }
    }
  }
  walk(el)
  return result
}

function isStatementElement(el: Element): boolean {
  return el.hasAttribute("StatementText")
}

function findAllStatementElements(root: Element): Element[] {
  const result: Element[] = []
  const walk = (el: Element) => {
    if (isStatementElement(el)) result.push(el)
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)
  return result
}

/** A statement's own QueryPlan — stops descending once it crosses into a
 * nested statement element, so a cursor/batch wrapper doesn't accidentally
 * claim its inner statement's plan as its own. */
function findDirectOrNearestQueryPlan(stmtEl: Element): Element | null {
  for (const child of Array.from(stmtEl.children)) {
    if (localName(child) === "QueryPlan") return child
    if (!isStatementElement(child)) {
      const found = findDirectOrNearestQueryPlan(child)
      if (found) return found
    }
  }
  return null
}

// ---- RelOp -> PlanNode ----

const PROMOTED_RELOP_ATTRS = new Set(["PhysicalOp", "LogicalOp", "EstimateRows", "EstimatedTotalSubtreeCost"])

function buildNode(relOp: Element, counter: { next: number }, role: PlanNodeRole): PlanNode {
  const id = `n${counter.next++}`

  const physicalOp = relOp.getAttribute("PhysicalOp") ?? "Unknown"
  const logicalOp = relOp.getAttribute("LogicalOp") ?? undefined
  const operatorType = mapSqlServerOperatorType(physicalOp, logicalOp)

  const estimatedRows = toFiniteNumber(relOp.getAttribute("EstimateRows"))
  const estimatedCost = toFiniteNumber(relOp.getAttribute("EstimatedTotalSubtreeCost"))

  const attributes: Record<string, string | number> = {}
  for (const attr of Array.from(relOp.attributes)) {
    if (PROMOTED_RELOP_ATTRS.has(attr.name)) continue
    attributes[attr.name] = attr.value
  }
  if (logicalOp) attributes["LogicalOp"] = logicalOp

  const objectEl = findNearestDescendant(relOp, "Object")
  if (objectEl) {
    for (const attr of Array.from(objectEl.attributes)) {
      attributes[`Object.${attr.name}`] = attr.value
    }
  }

  const runtime = readRunTimeInformation(relOp)
  if (runtime.threadCount !== undefined && runtime.threadCount > 1) {
    // Mirrors the Postgres parallel-worker labeling requirement: never
    // present a raw cross-thread sum as if it were a single-execution figure.
    attributes["Threads"] = runtime.threadCount
    attributes["Actual Time Is Cumulated Across Threads"] = "true"
  }

  // A tempdb spill (Sort/Hash ran out of memory grant) is reported as a
  // direct-child <Warnings><SpillOccurred SpillCounter="N"/></Warnings> —
  // promoted here since the rule engine's disk-spill rule needs an
  // easily-checkable attribute, same pattern as Snowflake's spill promotion.
  const warningsEl = findDirectChild(relOp, "Warnings")
  const spillEl = warningsEl && findDirectChild(warningsEl, "SpillOccurred")
  if (spillEl) {
    attributes["Spill Occurred"] = "true"
    const spillCounter = toFiniteNumber(spillEl.getAttribute("SpillCounter"))
    if (spillCounter !== undefined) attributes["Spill Count"] = spillCounter
  }

  const children = findChildRelOps(relOp).map((child) => buildNode(child, counter, role))

  return {
    id,
    engine: "sqlserver",
    operatorType,
    rawOperatorLabel: physicalOp,
    estimatedRows,
    actualRows: runtime.actualRows,
    estimatedCost,
    actualTimeMs: runtime.actualTimeMs,
    loops: runtime.loops,
    role,
    children,
    attributes,
    warnings: [],
  }
}

interface RuntimeSummary {
  actualRows?: number
  actualTimeMs?: number
  loops?: number
  threadCount?: number
}

/** `RunTimeInformation`/`RunTimeCountersPerThread` may be entirely absent
 * (an estimated-plan-only capture) — that's valid input, not an error. */
function readRunTimeInformation(relOp: Element): RuntimeSummary {
  const rtiEl = findDirectChild(relOp, "RunTimeInformation")
  if (!rtiEl) return {}

  const perThread = Array.from(rtiEl.children).filter((c) => localName(c) === "RunTimeCountersPerThread")
  if (perThread.length === 0) return {}

  let rowsSum = 0
  let rowsSeen = false
  let elapsedSum = 0
  let elapsedSeen = false
  let execSum = 0
  let execSeen = false

  for (const thread of perThread) {
    const rows = toFiniteNumber(thread.getAttribute("ActualRows"))
    if (rows !== undefined) {
      rowsSum += rows
      rowsSeen = true
    }
    const elapsed = toFiniteNumber(thread.getAttribute("ActualElapsedms"))
    if (elapsed !== undefined) {
      elapsedSum += elapsed
      elapsedSeen = true
    }
    const exec = toFiniteNumber(thread.getAttribute("ActualExecutions"))
    if (exec !== undefined) {
      execSum += exec
      execSeen = true
    }
  }

  return {
    actualRows: rowsSeen ? rowsSum : undefined,
    actualTimeMs: elapsedSeen ? elapsedSum : undefined,
    loops: execSeen ? execSum : undefined,
    threadCount: perThread.length,
  }
}

function parseMissingIndexes(stmtEl: Element): MissingIndexRecommendation[] {
  return findAllByLocalName(stmtEl, "MissingIndexGroup").map((group) => {
    const indexEl = findFirstByLocalName(group, "MissingIndex")
    const equalityColumns: string[] = []
    const inequalityColumns: string[] = []
    const includedColumns: string[] = []

    if (indexEl) {
      for (const colGroup of findAllByLocalName(indexEl, "ColumnGroup")) {
        const usage = colGroup.getAttribute("Usage")
        const columns = findAllByLocalName(colGroup, "Column").map((c) => c.getAttribute("Name") ?? "")
        if (usage === "EQUALITY") equalityColumns.push(...columns)
        else if (usage === "INEQUALITY") inequalityColumns.push(...columns)
        else if (usage === "INCLUDE") includedColumns.push(...columns)
      }
    }

    return {
      impact: toFiniteNumber(group.getAttribute("Impact")),
      database: indexEl?.getAttribute("Database") ?? undefined,
      schema: indexEl?.getAttribute("Schema") ?? undefined,
      table: indexEl?.getAttribute("Table") ?? undefined,
      equalityColumns,
      inequalityColumns,
      includedColumns,
    }
  })
}

function toFiniteNumber(value: string | null): number | undefined {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
