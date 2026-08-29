// Episode 18, Story 18.6 — the estimate-only honesty note. Postgres and SQL
// Server can both produce a plan with cost/row ESTIMATES but no actual
// execution numbers at all (Postgres: EXPLAIN without ANALYZE; SQL Server:
// an "estimated execution plan" capture, no RunTimeInformation). Every
// number this tool shows for a plan like that is the optimizer's guess, not
// a measurement — the same "a single pasted plan can't show you everything"
// honesty this codebase already applies to parameter sensitivity
// (parameterSensitivityNote.ts), extended to a second, genuinely distinct
// gap. See .claude/skills/rule-engine-authoring/SKILL.md's pattern for the
// shape this follows.
//
// NOT a PRD-documented commitment the way the parameter-sensitivity note
// is (docs/03-prd-v1.md §3 names that one explicitly; it says nothing about
// "estimate-only") — added here as a reasonable, in-spirit extension once
// building it turned out to need no new fixtures (src/fixtures/postgres/
// estimate-only-plan.json, .../estimate-only-plan-text.txt, and
// src/fixtures/sqlserver/estimated-plan-only.xml already existed, each
// currently used only to test parser-level graceful handling of missing
// "actual" fields, not any user-facing notice).

import { collectNodes } from "../parsers/normalize"
import type { Rule } from "./types"

const LONG_TEXT =
  "This plan has estimated costs and row counts, but no actual execution numbers — either it wasn't run " +
  "(EXPLAIN without ANALYZE, or an \"estimated plan\" capture), or the engine didn't report them. Every figure shown " +
  "here is the optimizer's prediction, not a measurement — treat cost/row values as a guide to the CHOSEN strategy, " +
  "not as evidence of how the query actually performed."

export const estimateOnlyNote: Rule = (node, context) => {
  if (node.id !== context.rootId) return [] // whole-plan-level disclosure, surfaced once — same pattern as parameterSensitivityNote

  // Snowflake's operator-stats output only ever describes a query that has
  // already run — there's no "estimated, not yet executed" capture mode to
  // disclose here, so this rule never fires for that engine (a genuine
  // cross-engine gap, not an oversight — see docs/10-node-stats-field-catalog.md's
  // own "genuine cross-engine gaps" framing for this same kind of call).
  if (context.engine === "snowflake") return []

  const hasAnyActualData = collectNodes(node).some((n) => n.actualTimeMs !== undefined || n.actualRows !== undefined)
  if (hasAnyActualData) return []

  return [
    {
      ruleId: "estimate-only-plan",
      severity: "info",
      shortText: "This is an estimated plan — no actual execution numbers (rows, timing) are available to compare against.",
      longText: LONG_TEXT,
    },
  ]
}

