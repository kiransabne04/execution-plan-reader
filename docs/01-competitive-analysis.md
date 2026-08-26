# PlanReader — Competitive Analysis

## 1. Tool-by-tool findings

### explain.depesz.com
- **Engines**: Postgres only.
- **Explains or visualizes**: Visualizes only — reformats raw TEXT/JSON `EXPLAIN` output into a colour-coded table (exclusive time, row estimate misses highlighted in red). No plain-language narrative of *why* something is a problem, no node-graph.
- **Pricing / friction**: Free, no signup. Oldest and most bookmarked tool in the space; still the default recommendation on Stack Overflow answers from 2012 onward.
- **UX complaints**: Table-only view, no visual tree/graph — people mentally rebuild the plan shape themselves. Styling is dated (largely unchanged in a decade). No support for anything but Postgres.
- **Gap**: No cross-engine support, no plain-English explanation, no graph visualization, single maintainer (bus-factor risk cited repeatedly in threads).

### explain.dalibo.com / PEV2
- **Engines**: Postgres only.
- **Explains or visualizes**: Visualizes — tree view plus a side panel that breaks out time/rows/costs/buffers per node, colour-coded similarly to Depesz. <cite index="4-1">The hosted version stores plans server-side by default, which enables sharing</cite>, and it <cite index="4-1">supports both TEXT and JSON format plans, with a side-panel that can show visualizations per statistic — time, rows, costs, or buffers</cite>.
- **Pricing / friction**: <cite index="4-1">Free and open source</cite>, no signup for basic use.
- **UX complaints**: Server-side storage by default is a real trust concern raised by users hosting it internally instead — <cite index="6-1">one user's organization was not comfortable using the hosted version "even though I have tried and failed to explain that it only stores data locally"</cite> — showing that even when a tool is client-side-safe, the *default* and the *messaging* both need to make that unambiguous. It points out issues with <cite index="4-1">less advice on what to do next</cite> than Depesz.
- **Gap**: Same single-engine limitation, no narrative explanation layer, privacy messaging/defaults are a known point of confusion even for a genuinely client-capable tool.

### pgMustard (surfaced as a close, commercial competitor — not in the original list but directly relevant)
- **Engines**: Postgres only.
- **Explains or visualizes**: Both — visual tree plus <cite index="13-1">tips added for a whole host of performance issues, scored based on an estimate of their time-saving potential, described in developer-friendly language aiming to help people solve their issue without requiring further help</cite>. This is the closest existing product to PlanReader's "explain in plain language" ambition, just commercial and Postgres-only.
- **Pricing / friction**: <cite index="12-1">Annual pricing starting at 95€/year, with a free trial allowing review of five of your own query plans</cite>. <cite index="17-1">No time limit on the trial itself, but only five real plans before paying.</cite>
- **Privacy stance worth copying**: <cite index="20-1">Plans are sent over SSL and are not stored server-side unless the user opts in; up to 20 recent plans are kept in browser local storage for convenience</cite> — a good, explicit trust default.
- **Gap for PlanReader**: No free public no-signup path once the five trial plans are used; single-engine; requires `EXPLAIN ANALYZE` minimum, so it can't help with plan review before running a query.

### SQL Sentry Plan Explorer (SolarWinds)
- **Engines**: SQL Server only.
- **Explains or visualizes**: Visualizes — a much better graphical/tabular plan viewer than SSMS's native one, with <cite index="24-1">scoring algorithms to help determine the best index for a query, recommended-index viewing, index creation/modification, and detection of stale statistics</cite>. It surfaces <cite index="28-1">expensive operators, plan shape, estimated vs. actual row counts, I/O, CPU, and waits</cite>, but this is presentation of the native plan data, not a plain-English narrative.
- **Pricing / friction**: <cite index="27-1">Free download</cite>, but it is a **desktop Windows app**, not a web tool — meaningful friction for anyone who wants to paste a plan and get an answer without installing anything.
- **Gap**: Not web-based, not cross-engine (it's tightly bound to `.sqlplan` XML), no plain-language explanation — it's a better lens on the same raw numbers, aimed at people who already know how to read a plan.

### Azure Data Studio's built-in plan viewer
- **Engines**: SQL Server / Azure SQL only.
- **Explains or visualizes**: Visualizes only — a graphical plan tree similar to SSMS's, with some added actual-vs-estimated highlighting in newer builds. No narrative explanation, no cross-engine support, and it's an IDE feature, not a standalone or shareable tool — you can't hand a teammate a link.
- **Gap**: Same category as SQL Sentry but with fewer analysis features; mainly relevant here as evidence that Microsoft's own tooling still leaves a plain-language gap.

### Snowflake's native Query Profile (Snowsight)
- **Engines**: Snowflake only.
- **Explains or visualizes**: Visualizes — <cite index="55-1">Query Graph view visualizes the flow of data through the query, with each node representing an operation and each arrow representing directional flow, including row counts along arrows</cite>, plus <cite index="55-1">error/warning messages and performance metrics</cite>. No plain-English narrative; interpreting spill, pruning, and exploding joins still requires DBA-level background knowledge, which is why third-party explainer content around it exists at all (see DataGeek.blog, ChaosGenius guides referenced in research).
- **Pricing / friction**: Free, but requires a Snowflake account and access to the specific query ID — it is not a paste-and-go tool, and it's locked inside Snowsight (no standalone sharable link for someone without account access).
- **Gap**: Zero portability outside Snowsight, zero plain-language layer, zero cross-engine value — this is the strongest validation for QueryDoc's approach and for a Snowflake lane inside PlanReader.

### Postgres.ai
- **Engines**: Postgres only.
- **Explains or visualizes**: Not primarily a plan visualizer — <cite index="72-1">its flagship products are DBLab (database branching / thin cloning for CI/CD testing) and Joe, a query optimization assistant</cite>. Joe is closer to a chat-based tuning assistant than a plan-paste tool.
- **Pricing / friction**: Open source core, hosted/enterprise tiers for the branching infrastructure.
- **Gap**: Different product category entirely (infra for testing, not plan explanation) — low direct overlap, but worth noting as an adjacent "Postgres AI tooling" brand PlanReader will be discovered alongside.

### EverSQL (now under Aiven)
- **Engines**: <cite index="31-1">PostgreSQL and MySQL</cite>.
- **Explains or visualizes**: Different job — <cite index="36-1">automatic query rewriting and index recommendation via AI, rather than explaining an existing plan</cite>. It does have a companion "SQL to Text" plain-English query explainer, but that explains the *query*, not the *plan*.
- **Pricing / friction**: <cite index="31-1">Freemium, with paid plans historically starting around $29–99/month</cite>; <cite index="70-1">the entry path now sits under Aiven, marketed toward ad hoc tuning — upload query, schema, and EXPLAIN output, and get rewrite/index recommendations without giving direct database access</cite>.
- **Gap**: It optimizes rather than explains, doesn't do a visual plan tree, and doesn't cover SQL Server or Snowflake.

### Others found in research (worth tracking as adjacent competition)
- **pganalyze** — <cite index="70-1">a production-operator's tool for Postgres that connects workload analysis, plan capture, log insight, and configuration guidance, with plan collection and visualization aimed at spotting regressions</cite>. Paid, ongoing-monitoring product, not a paste-a-plan free tool — different funnel stage (post-adoption, not top-of-funnel).
- **EDB Postgres AI** — <cite index="69-1">an enterprise sovereign data/AI platform built on Postgres that supports database optimization and query performance improvement as part of a much broader offering</cite>. Not a direct competitor; too heavyweight/enterprise to be a top-of-funnel alternative.

## 2. Feature-comparison matrix

| Tool | Engines | Explains in plain English | Node-graph visual | Free / signup | Client-side only | Standout gap |
|---|---|---|---|---|---|---|
| explain.depesz.com | Postgres | No | No (table only) | Free, no signup | Effectively yes | No graph, single engine |
| explain.dalibo.com (PEV2) | Postgres | Partial (issue tags, little advice) | Yes (tree) | Free, no signup | No — server-stored by default | Storage default undermines trust |
| pgMustard | Postgres | Yes, best-in-class advice | Yes (tree + timing bar) | 5-plan trial, then €95/yr | Yes (opt-in storage) | Not free after trial, single engine |
| SQL Sentry Plan Explorer | SQL Server | No | Yes (native-style graphical plan) | Free desktop app | Yes (local file) | Desktop-only, not web, single engine |
| Azure Data Studio plan viewer | SQL Server | No | Yes (graphical plan) | Free (IDE feature) | Yes | Not standalone/shareable, single engine |
| Snowflake Query Profile | Snowflake | No | Yes (query graph) | Free (needs account) | No (in-platform only) | Locked to Snowsight, no plain English |
| Postgres.ai (Joe/DBLab) | Postgres | Chat-based, different product | No | Open source / enterprise | N/A | Not a plan-paste tool |
| EverSQL / Aiven | Postgres, MySQL | Explains queries, not plans | No | Freemium, $29–99+/mo | No (server processes) | Optimizes rather than explains a plan |
| pganalyze | Postgres | Partial, advisor-style | Yes (plan collection) | Paid, monitoring product | No | Not top-of-funnel/free, ongoing tool |
| **PlanReader (proposed)** | **Postgres, SQL Server, Snowflake (MVP)** | **Yes, plain-language + optional LLM narrative** | **Yes, node-graph** | **Free, no signup** | **Client-side for rule path** | **First free, no-signup, multi-engine, plain-English tool** |

## 3. Where the open lane is

No existing tool combines all four of: (1) genuinely free with zero signup friction, (2) plain-language explanation rather than just visualization, (3) a node-graph visualization, and (4) support for more than one database engine. Every tool in the matrix picks at most two or three of those four. That's PlanReader's wedge — and it's also exactly the wedge that lets it act as a funnel: people land for a free, frictionless answer, and pgsuite (deeper Postgres observability) and QueryDoc (Snowflake-native, Cortex-powered diagnosis) are the natural "go deeper" step once someone hits the free tool's ceiling.
