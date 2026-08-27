// Story 1.1 — Parse well-formed (and not-so-well-formed) Postgres
// `EXPLAIN (FORMAT JSON)` output into the internal PlanNode tree.
// See .claude/skills/postgres-plan-parsing/SKILL.md and
// .claude/skills/plan-normalization/SKILL.md before editing.

import { PlanParseError, type PlanNode, type PlanNodeRole } from "../normalize"
import { cleanup } from "./cleanup"
import { derivePostgresExtendedFields } from "./extendedFields"
import { isDuplicateKeyMerge, parseLosslessJson } from "./losslessJsonParse"
import { mapPostgresOperatorType } from "./operatorMap"

type RawPlan = Record<string, unknown>

// Fields promoted to normalized PlanNode fields — excluded from the raw
// attributes bag so they aren't duplicated there.
const PROMOTED_FIELDS = new Set([
  "Node Type",
  "Plan Rows",
  "Total Cost",
  "Actual Total Time",
  "Actual Rows",
  "Actual Loops",
  "Plans",
  "Parent Relationship",
])

export function parsePostgresJsonPlan(rawInput: string): PlanNode {
  const cleaned = cleanup(rawInput)

  if (cleaned.length === 0) {
    throw new PlanParseError("EMPTY_INPUT", "Input is empty")
  }

  let parsed: unknown
  try {
    parsed = parseLosslessJson(cleaned)
  } catch (err) {
    if (err instanceof PlanParseError && err.code === "TRUNCATED_INPUT") {
      // Re-thrown as-is — a truncation-shaped error is worth a distinct,
      // more specific message than a generic "not a plan" one.
      throw err
    }
    // Any other JSON syntax error most likely means the user pasted
    // something that isn't JSON at all (SQL text, prose, etc.) — a raw
    // "invalid JSON" message would be jargon to a non-expert user.
    throw new PlanParseError(
      "NOT_A_PLAN",
      "This doesn't look like a Postgres JSON execution plan.",
    )
  }

  const container = extractPlanContainer(parsed)
  const planRaw = extractPlanObject(container)

  const counter = { next: 0 }
  const root = buildNode(planRaw, counter, "main")

  // Top-level fields that live alongside "Plan", not on it — preserved on
  // the root node's attributes bag rather than dropped.
  if (isRawPlan(container)) {
    for (const key of ["Planning Time", "Execution Time", "Triggers"]) {
      if (key in container) {
        root.attributes[key] = toAttributeValue(container[key])
      }
    }
  }

  return root
}

function isRawPlan(value: unknown): value is RawPlan {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `EXPLAIN (FORMAT JSON)` returns a top-level array with one element. Some
 * captures (e.g. certain GUI exports) hand back the bare object instead —
 * both are accepted. */
function extractPlanContainer(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new PlanParseError(
        "NOT_A_PLAN",
        "This doesn't look like a Postgres JSON execution plan (empty array).",
      )
    }
    return parsed[0]
  }
  if (isRawPlan(parsed)) {
    return parsed
  }
  throw new PlanParseError(
    "NOT_A_PLAN",
    "This doesn't look like a Postgres JSON execution plan.",
  )
}

function extractPlanObject(container: unknown): RawPlan {
  if (isRawPlan(container) && isRawPlan(container["Plan"])) {
    return container["Plan"] as RawPlan
  }
  if (isRawPlan(container) && typeof container["Node Type"] === "string") {
    // Already at the plan-node level (no "Plan" wrapper).
    return container
  }
  throw new PlanParseError(
    "NOT_A_PLAN",
    "This doesn't look like a Postgres JSON execution plan (no 'Plan'/'Node Type' field found).",
  )
}

function buildNode(raw: RawPlan, counter: { next: number }, role: PlanNodeRole): PlanNode {
  const id = `n${counter.next++}`

  const rawOperatorLabel = typeof raw["Node Type"] === "string" ? raw["Node Type"] : "Unknown"
  const operatorType = mapPostgresOperatorType(rawOperatorLabel)

  const estimatedRows = toFiniteNumber(raw["Plan Rows"])
  const estimatedCost = toFiniteNumber(raw["Total Cost"])
  // Missing ANALYZE fields must stay absent (undefined), never coerced to 0/NaN.
  const actualTimeMs = toFiniteNumber(raw["Actual Total Time"])
  const actualRows = toFiniteNumber(raw["Actual Rows"])
  const loops = toFiniteNumber(raw["Actual Loops"])

  const childrenRaw = collectChildren(raw["Plans"])
  const children = childrenRaw.map((child) => buildNode(child, counter, roleFor(child)))

  const attributes: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (PROMOTED_FIELDS.has(key)) continue
    attributes[key] = toAttributeValue(value)
  }

  const extended = derivePostgresExtendedFields(attributes, actualTimeMs)

  return {
    id,
    engine: "postgres",
    operatorType,
    rawOperatorLabel,
    estimatedRows,
    actualRows,
    estimatedCost,
    actualTimeMs,
    loops,
    role,
    children,
    attributes,
    warnings: [],
    ...extended,
  }
}

/** InitPlan/SubPlan nodes are tagged via Postgres's own `Parent Relationship`
 * attribute so the graph layer can render them off the main execution path. */
function roleFor(raw: RawPlan): PlanNodeRole {
  const rel = raw["Parent Relationship"]
  if (rel === "InitPlan") return "init"
  if (rel === "SubPlan") return "sub"
  return "main"
}

/** `Plans` is normally an array of child node objects. If the same node had
 * two `"Plans"` keys, the lossless parser merges them into an array of
 * arrays — flatten that one level so both sets of children still show up. */
function collectChildren(plansValue: unknown): RawPlan[] {
  if (!Array.isArray(plansValue)) return []
  if (isDuplicateKeyMerge(plansValue)) {
    return plansValue.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])) as RawPlan[]
  }
  return plansValue as RawPlan[]
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Attributes bag only holds string|number (see PlanNode contract) — any
 * non-primitive raw value (arrays, nested objects, duplicate-key merges such
 * as Postgres's per-worker `Workers` data) is preserved as a JSON string
 * rather than dropped, so no information is lost. */
function toAttributeValue(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}
