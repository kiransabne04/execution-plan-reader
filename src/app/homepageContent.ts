// Episode SEO-02, Story 02.2 — copy for the homepage content sections that
// render below the analyzer shell (Supported Databases -> What PlanReader
// Detects -> Why PlanReader -> How It Works -> Privacy -> Try an Example ->
// Learn More -> FAQ). Single source of truth, same pattern as
// emptyStateCopy.ts/positioningCopy.ts: HomepageSections.tsx renders these
// constants, and a test asserts every factual claim below actually matches
// what the app does (rule coverage, parser input formats, privacy
// architecture) rather than drifting into marketing copy nobody checks.
//
// Deliberately short per section (the story's own brief: "Don't add a
// giant 2,000-word article") — scannable, not an essay.

export interface SupportedDatabase {
  engine: string
  format: string
}

export const SUPPORTED_DATABASES: SupportedDatabase[] = [
  { engine: "PostgreSQL", format: "EXPLAIN (ANALYZE, BUFFERS) output — JSON or plain text" },
  { engine: "SQL Server", format: "Showplan XML (.sqlplan) — the Actual Execution Plan" },
  { engine: "Snowflake", format: "GET_QUERY_OPERATOR_STATS() output or exported Query Profile JSON" },
]

// Reflects real rule-engine coverage (src/rules/) — see
// .claude/skills/rule-engine-authoring/SKILL.md's MVP rule set. Kept to
// categories, not an exhaustive list of every rule file.
export const WHAT_IT_DETECTS: string[] = [
  "Expensive sequential or full table scans on large tables",
  "Row estimate mismatches, where the planner misjudges how many rows a step will touch",
  "Disk spills — sorts and hashes that overflow available memory",
  "Inefficient joins — nested loop blowups, exploding joins, and cartesian joins",
  "Missing index opportunities, where derivable from the plan itself",
  "Engine-specific issues — SQL Server key lookup explosions and memory grant problems, Snowflake partition pruning and spill",
]

export const WHY_PLANREADER: string[] = [
  "Free, no signup, no account",
  "100% client-side — nothing you paste ever leaves your browser",
  "Plain-English explanations, not just raw operator names",
  "Interactive node-graph visualization of the whole plan",
  "One tool for PostgreSQL, SQL Server, and Snowflake",
]

export interface HowItWorksStep {
  title: string
  description: string
}

export const HOW_IT_WORKS: HowItWorksStep[] = [
  { title: "Paste your plan", description: "EXPLAIN output, Showplan XML, or Snowflake operator stats." },
  {
    title: "Parsed and analyzed locally",
    description: "The rule engine flags scans, spills, bad estimates, and inefficient joins — entirely in your browser.",
  },
  {
    title: "Explore the graph",
    description: "Click any node for a plain-English breakdown, or copy a share link — nothing is stored on a server.",
  },
]

// Matches the real privacy architecture (see
// .claude/skills/privacy-architecture/SKILL.md and shareLink.ts) —
// intentionally exact wording, not loosened for marketing effect.
export const PRIVACY_POINTS: string[] = [
  "Nothing you paste is ever sent to a server — parsing and analysis run entirely in your browser",
  "No account, no signup, no tracking of plan content",
  "Share links encode your plan into the URL itself, in a fragment your browser never sends in any request — not stored anywhere",
  "Local history, if you use it, stays in your own browser's storage",
]

export const TRY_AN_EXAMPLE_HEADING = "Try an Example"
export const TRY_AN_EXAMPLE_BODY = "No plan handy? Load a real sample for each engine above and see PlanReader work immediately."
export const TRY_AN_EXAMPLE_CTA = "Load a sample plan"
// The real, working sample buttons already live inside the paste box —
// this section's CTA scrolls there rather than duplicating the same
// three buttons and their loadSample() wiring a second time.
export const SAMPLE_PLANS_ANCHOR_ID = "sample-plans"

// Deliberately doesn't repeat the creator attribution already carried by
// `.plan-reader-page__credit` elsewhere in the app (same reason that
// element's own comment gives for existing at all) — this section's real
// job is pointing at the in-app education that's already there, not
// re-stating authorship a second time.
export const LEARN_MORE_BODY =
  "Every node in the graph includes a plain-English glossary entry — click a node, then \"Learn more\" for what the operator does, when it's fine, and when it's worth a second look. That's the fastest way to go deeper on any specific operator without leaving the tool."

export interface FaqItem {
  question: string
  answer: string
}

// The last item deliberately restates the rule engine's own
// parameter-sensitivity honesty note (rule-engine-authoring skill) rather
// than a stronger, false-confidence claim.
export const FAQ_ITEMS: FaqItem[] = [
  { question: "Is PlanReader free?", answer: "Yes — free, no signup, no account required." },
  {
    question: "Is my execution plan sent to a server?",
    answer: "No. Parsing and analysis run 100% client-side in your browser; nothing you paste is ever transmitted.",
  },
  { question: "Which databases are supported?", answer: "PostgreSQL, SQL Server, and Snowflake." },
  {
    question: "Can I share a plan with a teammate?",
    answer: "Yes — the share link encodes your plan directly in the URL. It's never stored on a server.",
  },
  {
    question: "Can PlanReader tell me why a query is sometimes fast and sometimes slow?",
    answer:
      "Not definitively. A single pasted plan is one snapshot of one execution — if a query's performance varies, a different plan may be used for different input values, which one pasted plan can't show you.",
  },
]
