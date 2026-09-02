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

import {
  computeCacheHitRatio,
  normalizeJoinLogicalType,
  PlanParseError,
  type IndexInfo,
  type PlanNode,
  type PlanNodeRole,
} from "../normalize"
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

    // Episode 23, Story 23.2 — query-level (not per-node) parallelism facts,
    // read off the QueryPlan element itself and attached to the root node's
    // own `parallel`, the same "root-only, read after buildNode returns"
    // pattern parseJsonPlan.ts already uses for Postgres's Planning Time.
    // DegreeOfParallelism is the COMPILED plan's DOP — genuinely different
    // from the per-node `workersLaunched` (observed thread count) buildNode
    // already sets above; comparing the two is exactly what the new
    // parallel-worker-shortfall rule does for SQL Server.
    const compiledDegreeOfParallelism = toFiniteNumber(queryPlanEl.getAttribute("DegreeOfParallelism"))
    const nonParallelPlanReason = queryPlanEl.getAttribute("NonParallelPlanReason") ?? undefined
    if (compiledDegreeOfParallelism !== undefined || nonParallelPlanReason !== undefined) {
      root.parallel = { ...root.parallel, compiledDegreeOfParallelism, nonParallelPlanReason }
    }

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
  // direct-child <Warnings><SpillToTempDb SpillLevel="N"/></Warnings> —
  // promoted here since the rule engine's disk-spill rule needs an
  // easily-checkable attribute, same pattern as Snowflake's spill promotion.
  const warningsEl = findDirectChild(relOp, "Warnings")
  const spillEl = warningsEl && findDirectChild(warningsEl, "SpillToTempDb")
  const spillLevel = spillEl ? toFiniteNumber(spillEl.getAttribute("SpillLevel")) : undefined
  if (spillEl) {
    attributes["Spill Occurred"] = "true"
    if (spillLevel !== undefined) attributes["Spill Level"] = spillLevel
  }

  const predicateText = extractScalarString(findNearestDescendant(relOp, "Predicate"))
  const seekPredicateText = extractSeekPredicateText(findNearestDescendant(relOp, "SeekPredicates"))
  // Join condition extraction (HashKeysBuild/HashKeysProbe for hash joins,
  // InnerSideJoinColumns/OuterReferences for nested loop) varies enough by
  // join algorithm that a generic extraction risks silently grabbing the
  // wrong element — left as an honest gap for SQL Server rather than a
  // fragile guess (see docs/10-node-stats-field-catalog.md §1).
  const predicate =
    predicateText || seekPredicateText ? { filter: predicateText, indexCondition: seekPredicateText } : undefined

  const indexType = mapIndexKind(objectEl?.getAttribute("IndexKind") ?? undefined)
  const indexName = objectEl?.getAttribute("Index") ?? undefined
  const index = indexName || indexType ? { name: indexName ?? undefined, type: indexType } : undefined

  const join = operatorType.includes("join")
    ? (() => {
        const logicalType = normalizeJoinLogicalType(logicalOp)
        return logicalType ? { logicalType } : undefined
      })()
    : undefined

  // Approximate only: SQL Server doesn't cleanly separate "from cache" vs
  // "from disk" the way Postgres's Shared Hit/Read Blocks split does.
  // Logical reads include cache hits; hits = logical - physical.
  const bufferReads = runtime.physicalReads
  const bufferHits =
    runtime.logicalReads !== undefined && runtime.physicalReads !== undefined
      ? Math.max(0, runtime.logicalReads - runtime.physicalReads)
      : undefined
  const io =
    bufferHits !== undefined || bufferReads !== undefined || runtime.readAheads !== undefined
      ? { bufferHits, bufferReads, cacheHitRatio: computeCacheHitRatio(bufferHits, bufferReads), readAheads: runtime.readAheads }
      : undefined

  const spill: PlanNode["spill"] = spillEl
    ? { occurred: true, detail: spillLevel !== undefined ? `spill level ${spillLevel}` : undefined }
    : undefined

  const parallel =
    runtime.threadCount !== undefined && runtime.threadCount > 1 ? { workersLaunched: runtime.threadCount } : undefined

  // SQL Server's per-thread ActualElapsedms is genuinely summed with no
  // built-in averaging (unlike Postgres's already-loop-averaged figure) —
  // approximate per-execution by dividing the cumulated total across
  // whichever axis actually multiplied it (threads, then loops).
  const actualTimePerExecutionMs =
    runtime.actualTimeMs === undefined
      ? undefined
      : runtime.threadCount && runtime.threadCount > 1
        ? runtime.actualTimeMs / runtime.threadCount
        : runtime.loops && runtime.loops > 1
          ? runtime.actualTimeMs / runtime.loops
          : runtime.actualTimeMs

  const children = findChildRelOps(relOp).map((child) => buildNode(child, counter, role))

  return {
    id,
    engine: "sqlserver",
    operatorType,
    rawOperatorLabel: physicalOp,
    estimatedRows,
    actualRows: runtime.actualRows,
    rowsRemovedByFilter: subtractDefined(runtime.actualRowsRead, runtime.actualRows),
    estimatedCost,
    actualTimeMs: runtime.actualTimeMs,
    actualTimePerExecutionMs,
    loops: runtime.loops,
    role,
    predicate,
    index,
    join,
    io,
    spill,
    parallel,
    children,
    attributes,
    warnings: [],
  }
}

const INDEX_KIND_MAP: Record<string, NonNullable<IndexInfo["type"]>> = {
  Clustered: "clustered",
  NonClustered: "nonclustered",
  Heap: "heap",
  Columnstore: "columnstore",
}

function mapIndexKind(raw: string | undefined): IndexInfo["type"] {
  if (!raw) return undefined
  return INDEX_KIND_MAP[raw]
}

/** Real Showplan XML nests the human-readable predicate text inside a
 * `ScalarOperator`'s `ScalarString` attribute, potentially several levels
 * deep under `Predicate`/`SeekPredicates` — take the first one found. */
function extractScalarString(container: Element | undefined): string | undefined {
  if (!container) return undefined
  const scalarOp = findAllByLocalName(container, "ScalarOperator").find((el) => el.hasAttribute("ScalarString"))
  return scalarOp?.getAttribute("ScalarString") ?? undefined
}

/** A composite (multi-column) index seek's `SeekPredicates` is structurally
 * different from `Predicate`/`Filter`: rather than one `ScalarOperator`
 * whose `ScalarString` already spells out the whole boolean expression,
 * SQL Server emits one `ScalarOperator` PER seek column, as direct children
 * of each `Prefix`/`StartRange`/`EndRange`'s `RangeExpressions` element —
 * `extractScalarString`'s "take the first ScalarString found anywhere"
 * approach silently drops every column after the first for any seek on more
 * than one key column. Multiple sibling seek-predicate groups (e.g. a
 * compiled IN-list) are alternatives, joined with " OR "; columns within one
 * group are joined with " AND ", matching how the condition actually reads. */
function extractSeekPredicateText(seekPredicatesEl: Element | undefined): string | undefined {
  if (!seekPredicatesEl) return undefined
  const groupTexts = Array.from(seekPredicatesEl.children)
    .map((group) => {
      const columnTexts = findAllByLocalName(group, "RangeExpressions").flatMap((rangeExpressions) =>
        Array.from(rangeExpressions.children)
          .filter((child) => localName(child) === "ScalarOperator" && child.hasAttribute("ScalarString"))
          .map((child) => child.getAttribute("ScalarString")!),
      )
      return columnTexts.join(" AND ")
    })
    .filter((text) => text.length > 0)
  return groupTexts.length > 0 ? groupTexts.join(" OR ") : undefined
}

function subtractDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined || a < b) return undefined
  return a - b
}

interface RuntimeSummary {
  actualRows?: number
  actualRowsRead?: number
  actualTimeMs?: number
  loops?: number
  threadCount?: number
  /** Logical reads = physical (disk) reads + reads satisfied from cache —
   * NOT the same as "hits" on its own (see field catalog §5's note that
   * this split is only approximate on SQL Server, unlike Postgres's clean
   * Shared Hit/Read Blocks separation). */
  logicalReads?: number
  physicalReads?: number
  /** `ActualReadAheads` — SQL Server's deliberate sequential-prefetch
   * mechanism, counted separately from an ordinary physical read (see
   * `IoInfo.readAheads`'s own doc comment in normalize.ts). */
  readAheads?: number
}

/** Sums a numeric attribute across all per-thread elements, returning
 * `undefined` (not 0) if the attribute never appeared on any of them —
 * absence must stay distinguishable from a real zero. */
function sumThreadAttr(threads: Element[], attrName: string): number | undefined {
  let sum = 0
  let seen = false
  for (const thread of threads) {
    const value = toFiniteNumber(thread.getAttribute(attrName))
    if (value !== undefined) {
      sum += value
      seen = true
    }
  }
  return seen ? sum : undefined
}

/** `RunTimeInformation`/`RunTimeCountersPerThread` may be entirely absent
 * (an estimated-plan-only capture) — that's valid input, not an error. */
function readRunTimeInformation(relOp: Element): RuntimeSummary {
  const rtiEl = findDirectChild(relOp, "RunTimeInformation")
  if (!rtiEl) return {}

  const perThread = Array.from(rtiEl.children).filter((c) => localName(c) === "RunTimeCountersPerThread")
  if (perThread.length === 0) return {}

  return {
    actualRows: sumThreadAttr(perThread, "ActualRows"),
    actualRowsRead: sumThreadAttr(perThread, "ActualRowsRead"),
    actualTimeMs: sumThreadAttr(perThread, "ActualElapsedms"),
    loops: sumThreadAttr(perThread, "ActualExecutions"),
    logicalReads: sumThreadAttr(perThread, "ActualLogicalReads"),
    physicalReads: sumThreadAttr(perThread, "ActualPhysicalReads"),
    readAheads: sumThreadAttr(perThread, "ActualReadAheads"),
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
