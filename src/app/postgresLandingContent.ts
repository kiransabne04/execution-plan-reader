// Episode SEO-03, Story 03.1 — copy for the standalone PostgreSQL product
// landing page (`/postgresql-execution-plan-analyzer`). Single source of
// truth: `PostgresLandingPage.tsx` renders these constants, and
// `postgresql-execution-plan-analyzer.html`'s static snapshot mirrors them
// literally (checked by `postgresLandingSnapshot.test.ts`) for the same
// non-JS-crawler reason `homepageContent.ts`'s own header comment gives.
//
// Rule ids named in WHAT_IT_DETECTS are real strings from src/rules/ —
// see postgresLandingContent.test.ts's own registry check — never
// invented capability.

import { PRIVACY_POINTS } from "./homepageContent"

export const PAGE_TITLE = "PostgreSQL EXPLAIN ANALYZE Visualizer & Execution Plan Analyzer | PlanReader"
export const META_DESCRIPTION =
  "Paste a PostgreSQL EXPLAIN plan (JSON or plain text) and get a free, plain-English breakdown with an interactive node graph. No signup, fully client-side."
export const CANONICAL_URL = "https://www.planreader.dev/postgresql-execution-plan-analyzer"

export const H1 = "PostgreSQL Execution Plan Analyzer"
export const INTRO =
  "Paste real EXPLAIN output from PostgreSQL and get a plain-English breakdown of what's slow and why, with an interactive node-graph visualization — free, no signup, nothing sent to a server."

export const ANALYZER_CTA_TEXT = "Analyze your plan free"
export const ANALYZER_CTA_HREF = "/"

export const WHAT_PLANREADER_ANALYZES =
  "PlanReader parses your EXPLAIN output into a normalized plan tree entirely in your browser, runs it through a rule engine that checks for known Postgres performance problems, and renders the result as an interactive node graph you can click through node by node."

export interface InputFormat {
  label: string
  description: string
}

export const SUPPORTED_INPUT_FORMATS: InputFormat[] = [
  { label: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)", description: "the full JSON plan output, including buffer and timing statistics" },
  { label: "EXPLAIN ANALYZE (plain text)", description: "the default psql-style text output, including auto_explain captures" },
]

export interface DetectedIssue {
  ruleId: string
  label: string
}

export const WHAT_IT_DETECTS: DetectedIssue[] = [
  { ruleId: "seq-scan-on-large-table", label: "Sequential scan on a large table" },
  { ruleId: "bad-row-estimate", label: "Row-estimate vs. actual-row mismatches" },
  { ruleId: "disk-spill", label: "Disk-based sort or hash spills" },
  { ruleId: "exploding-join", label: "Nested loop joins producing far more rows than estimated" },
  { ruleId: "missing-index-opportunity", label: "Missing index opportunities, where derivable from the plan itself" },
  { ruleId: "non-sargable-predicate", label: "Non-sargable predicates that prevent index use" },
  { ruleId: "buffer-cache-inefficiency", label: "Buffer cache inefficiency and heavy disk reads" },
  { ruleId: "parallel-worker-shortfall", label: "Parallel worker shortfalls against the planned degree of parallelism" },
]

export const EXAMPLE_FINDING_HEADING = "Example finding"
export const EXAMPLE_FINDING_BODY =
  "A nested loop join estimated 12 rows but actually produced 6,104 — a 500x miss that made it the most expensive step in the query. PlanReader flags this as an exploding join, shows exactly where it happens in the graph, and explains in plain English what usually causes it (stale statistics or a bad selectivity estimate) instead of just showing you a row-count table."

export const HOW_TO_GENERATE_HEADING = "How to generate EXPLAIN input"
export const HOW_TO_GENERATE_JSON_LABEL = "For the JSON format (recommended — includes buffer stats):"
export const HOW_TO_GENERATE_JSON_COMMAND = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ...;"
export const HOW_TO_GENERATE_TEXT_LABEL = "For plain text:"
export const HOW_TO_GENERATE_TEXT_COMMAND = "EXPLAIN ANALYZE SELECT ...;"

export const TRY_SAMPLE_HEADING = "Try a sample plan"
export const TRY_SAMPLE_BODY = "No plan handy? Load a real Postgres sample and see PlanReader work immediately — no paste required."
export const TRY_SAMPLE_CTA_TEXT = "Try a sample Postgres plan"
export const TRY_SAMPLE_CTA_HREF = "/#sample-plans"

export const DEEP_LEARNING_HEADING = "Deep learning resources"
export const DEEP_LEARNING_BODY = "For a comprehensive guide to reading EXPLAIN output beyond what PlanReader's own detections cover:"
export const DEEP_LEARNING_LINK_TEXT = "kiransabne.dev"
export const DEEP_LEARNING_LINK_HREF = "https://kiransabne.dev"

export { PRIVACY_POINTS }
