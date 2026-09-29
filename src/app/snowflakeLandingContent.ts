// Episode SEO-03, Story 03.3 — copy for the standalone Snowflake product
// landing page (`/snowflake-query-profile-analyzer`). Single source of
// truth: `SnowflakeLandingPage.tsx` renders these constants, and
// `snowflake-query-profile-analyzer.html`'s static snapshot mirrors them
// literally (checked by `snowflakeLandingSnapshot.test.ts`), same reason
// `homepageContent.ts`'s own header comment gives.
//
// Rule ids named in WHAT_IT_DETECTS are real strings from src/rules/ —
// see SnowflakeLandingPage.test.tsx's own registry check. Deliberately
// scoped to GET_QUERY_OPERATOR_STATS()/Query Profile JSON operator-level
// analysis only — no mention of Query Context / QUERY_HISTORY / warehouse
// queuing / QAS anywhere on this page. That's Episode 35, a separate,
// held, architecturally-undecided input source (see BACKLOG-STATUS.md's
// "Planned next" note) — a genuinely different input this page must not
// imply already exists. No "deep learning resources" link: no equivalent
// third-party site is named for Snowflake, so that section is omitted
// entirely rather than filled with an invented or unrelated URL.

import { PRIVACY_POINTS } from "./homepageContent"

export const PAGE_TITLE = "Snowflake Query Profile Analyzer | PlanReader"
export const META_DESCRIPTION =
  "Paste Snowflake GET_QUERY_OPERATOR_STATS() output or an exported Query Profile and get a free, plain-English breakdown with an interactive node graph. No signup, fully client-side."
export const CANONICAL_URL = "https://www.planreader.dev/snowflake-query-profile-analyzer"

export const H1 = "Snowflake Query Profile Analyzer"
export const INTRO =
  "Paste real operator-profile output from Snowflake and get a plain-English breakdown of what's slow and why, with an interactive node-graph visualization — free, no signup, nothing sent to a server."

export const ANALYZER_CTA_TEXT = "Analyze your plan free"
export const ANALYZER_CTA_HREF = "/"

export const WHAT_PLANREADER_ANALYZES =
  "PlanReader parses your query profile into a normalized plan tree entirely in your browser, runs it through a rule engine that checks for known Snowflake operator-level performance problems, and renders the result as an interactive node graph you can click through node by node. This tool analyzes the operator profile of a single query — not warehouse-level or account-level query history."

export interface InputFormat {
  label: string
  description: string
}

export const SUPPORTED_INPUT_FORMATS: InputFormat[] = [
  { label: "GET_QUERY_OPERATOR_STATS() output", description: "the table function's result, pasted directly" },
  { label: "Exported Query Profile JSON", description: "the JSON export of a query's profile" },
]

export interface DetectedIssue {
  ruleId: string
  label: string
}

export const WHAT_IT_DETECTS: DetectedIssue[] = [
  { ruleId: "poor-partition-pruning", label: "Poor micro-partition pruning" },
  { ruleId: "cartesian-join", label: "Cartesian joins" },
  { ruleId: "aggregation-hotspot", label: "Aggregation hotspots" },
  { ruleId: "window-hotspot", label: "Window function hotspots" },
  { ruleId: "external-function-hotspot", label: "External function hotspots" },
  { ruleId: "sort-hotspot", label: "Sort hotspots" },
  { ruleId: "local-spill", label: "Local (disk) spill" },
  { ruleId: "remote-spill", label: "Remote (cloud storage) spill" },
  { ruleId: "search-optimization-effectiveness", label: "Search Optimization Service effectiveness" },
  { ruleId: "result-transfer-bottleneck", label: "Result-transfer bottlenecks" },
  { ruleId: "dml-scope-inefficiency", label: "DML scope inefficiency (UPDATE/DELETE/MERGE examining far more rows than changed)" },
]

export const EXAMPLE_FINDING_HEADING = "Example finding"
export const EXAMPLE_FINDING_BODY =
  "An aggregation spilled to remote storage mid-query, adding cloud-storage round trips on top of the compute cost. PlanReader flags this as a remote spill, shows exactly which operator spilled in the graph, and explains in plain English that the operator needed more memory than the warehouse size provided — instead of just showing you a raw bytes-spilled counter."

export const HOW_TO_GENERATE_HEADING = "How to get this output"
export const HOW_TO_GENERATE_LABEL = "Using the query's own ID:"
export const HOW_TO_GENERATE_COMMAND = "SELECT * FROM TABLE(GET_QUERY_OPERATOR_STATS('<query_id>'));"

export const TRY_SAMPLE_HEADING = "Try a sample plan"
export const TRY_SAMPLE_BODY = "No plan handy? Load a real Snowflake sample and see PlanReader work immediately — no paste required."
export const TRY_SAMPLE_CTA_TEXT = "Try a sample Snowflake plan"
export const TRY_SAMPLE_CTA_HREF = "/#sample-plans"

export { PRIVACY_POINTS }
