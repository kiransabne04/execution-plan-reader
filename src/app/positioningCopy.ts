// Episode 8, Story 8.1 — sourced verbatim from
// docs/05-landing-page-positioning.md, the reviewed positioning brief.
// Acceptance criteria requires this to match the brief exactly, so it lives
// here as a single reviewed source rather than being retyped inline in a
// component (where it could drift from the brief over time unnoticed).

export const HERO_HEADLINE = "Paste your database execution plan. Get a plain-English explanation."

export const HERO_SUBHEADLINE =
  "Free, no signup. Works with Postgres, SQL Server, and Snowflake — paste your plan, see a visual breakdown of what's slow and why."

export const SUPPORTED_ENGINES = ["Postgres", "SQL Server", "Snowflake"] as const

/** A truncated real example so the input format is self-evident without
 * reading instructions — doubles as an implicit "yes, this is the right
 * kind of tool for what you have" confirmation (brief's on-page checklist). */
export const PASTE_BOX_PLACEHOLDER = `[
  {
    "Plan": {
      "Node Type": "Seq Scan",
      "Relation Name": "orders",
      "Total Cost": 22.00,
      ...
Paste your full Postgres JSON/TEXT, SQL Server Showplan XML, or Snowflake operator-stats JSON here.`
