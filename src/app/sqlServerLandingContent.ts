// Episode SEO-03, Story 03.2 — copy for the standalone SQL Server product
// landing page (`/sql-server-execution-plan-analyzer`). Single source of
// truth: `SqlServerLandingPage.tsx` renders these constants, and
// `sql-server-execution-plan-analyzer.html`'s static snapshot mirrors them
// literally (checked by `sqlServerLandingSnapshot.test.ts`), same reason
// `homepageContent.ts`'s own header comment gives.
//
// Rule ids named in WHAT_IT_DETECTS are real strings from src/rules/ —
// see SqlServerLandingPage.test.tsx's own registry check. `.sqlplan` /
// Showplan XML support and multi-statement batches are both confirmed
// real, current capabilities (docs/BACKLOG-STATUS.md Episode 2 Story 2.1,
// Episode 27-29) at the time this copy was written — re-check that file
// before editing this copy if either capability's status ever changes.

import { PRIVACY_POINTS } from "./homepageContent"

export const PAGE_TITLE = "SQL Server Execution Plan Analyzer & Showplan Viewer | PlanReader"
export const META_DESCRIPTION =
  "Paste a SQL Server Showplan XML (.sqlplan) execution plan and get a free, plain-English breakdown with an interactive node graph. No signup, fully client-side."
export const CANONICAL_URL = "https://www.planreader.dev/sql-server-execution-plan-analyzer"

export const H1 = "SQL Server Execution Plan Analyzer"
export const INTRO =
  "Paste a real Showplan XML (.sqlplan) execution plan from SQL Server and get a plain-English breakdown of what's slow and why, with an interactive node-graph visualization — free, no signup, nothing sent to a server."

export const ANALYZER_CTA_TEXT = "Analyze your plan free"
export const ANALYZER_CTA_HREF = "/"

export const WHAT_PLANREADER_ANALYZES =
  "PlanReader parses your Showplan XML into a normalized plan tree entirely in your browser, runs it through a rule engine that checks for known SQL Server performance problems, and renders the result as an interactive node graph you can click through node by node."

export interface InputFormat {
  label: string
  description: string
}

export const SUPPORTED_INPUT_FORMATS: InputFormat[] = [
  { label: "Showplan XML (.sqlplan)", description: "the Actual Execution Plan, including runtime counters" },
  { label: "Showplan XML — estimated plans", description: "an Estimated Execution Plan works too, with the honest gap disclosed for any statistic that only exists on an actual plan" },
  { label: "Multi-statement batches", description: "a single Showplan XML containing more than one statement is broken out per-statement, with its own summary" },
]

export interface DetectedIssue {
  ruleId: string
  label: string
}

export const WHAT_IT_DETECTS: DetectedIssue[] = [
  { ruleId: "key-lookup-explosion", label: "Key Lookup / RID Lookup explosions (a per-row lookup running far more times than it should)" },
  { ruleId: "residual-predicate-heavy", label: "Row-estimate (cardinality) mismatches between an index seek and its residual predicate" },
  { ruleId: "sqlserver-sort-spill", label: "Sort spills to tempdb" },
  { ruleId: "sqlserver-hash-spill", label: "Hash Match spills to tempdb" },
  { ruleId: "memory-grant-excessive", label: "Excessive memory grants" },
  { ruleId: "memory-grant-pressure", label: "Memory grant pressure" },
  { ruleId: "implicit-conversion", label: "Implicit conversions that block index use" },
  { ruleId: "exchange-data-movement", label: "Parallel exchange data-movement cost" },
]

export const EXAMPLE_FINDING_HEADING = "Example finding"
export const EXAMPLE_FINDING_BODY =
  "A Key Lookup ran 1,200 times feeding a single Index Seek — each lookup individually cheap, but the total cost dominated the query. PlanReader flags this as a Key Lookup explosion, shows the seek-plus-lookup pair together in the graph, and explains in plain English that a covering index (one that includes the looked-up columns) would remove the lookup entirely, instead of just showing you a raw execution count."

export const HOW_TO_GENERATE_HEADING = "How to generate a Showplan XML"
export const HOW_TO_GENERATE_SSMS_LABEL = "In SQL Server Management Studio:"
export const HOW_TO_GENERATE_SSMS_STEPS = [
  "Enable \"Include Actual Execution Plan\" (Ctrl+M) before running the query, for an actual plan with real row counts and timings",
  "Run the query, then right-click the resulting plan tab and choose \"Save Execution Plan As...\" to get a .sqlplan file, or copy its raw XML",
]
export const HOW_TO_GENERATE_TSQL_LABEL = "Or via T-SQL, for a text/XML capture:"
export const HOW_TO_GENERATE_TSQL_COMMAND = "SET STATISTICS XML ON;"

export const TRY_SAMPLE_HEADING = "Try a sample plan"
export const TRY_SAMPLE_BODY = "No plan handy? Load a real SQL Server sample and see PlanReader work immediately — no paste required."
export const TRY_SAMPLE_CTA_TEXT = "Try a sample SQL Server plan"
export const TRY_SAMPLE_CTA_HREF = "/#sample-plans"

export const DEEP_LEARNING_HEADING = "Deep learning resources"
export const DEEP_LEARNING_BODY = "For deep technical coverage of SQL Server execution plans beyond what PlanReader's own detections cover:"
export const DEEP_LEARNING_LINK_TEXT = "mssqlserver.dev"
export const DEEP_LEARNING_LINK_HREF = "https://mssqlserver.dev"

export { PRIVACY_POINTS }
