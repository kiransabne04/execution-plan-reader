# PlanReader — Product Requirements Document v1

**Owner:** Kiran Sabne (@scalingbackend)
**Status:** Draft for review
**Domains:** planreader.dev (primary), planreader.app (redirect-only)

---

## 1. Problem statement

Every major database engine exposes an execution plan, and every plan format is dense, engine-specific, and unfriendly to anyone who isn't already fluent in query optimization. The tools that exist today (see companion Competitive Analysis) each solve one slice of the problem: Depesz and PEV2 visualize Postgres plans but don't explain them in plain language; pgMustard explains Postgres plans well but is paywalled after five uses; SQL Sentry and Azure Data Studio give SQL Server users a better graphical view of the same raw numbers, with no narrative; Snowflake's own Query Profile is locked inside Snowsight with no plain-English layer at all. Nobody offers a single, free, no-signup destination where someone can paste *any* of the plan formats they're likely to encounter in a mixed-stack job and get back both a visual and an explanation they can actually act on.

## 2. Goals

1. Give anyone — regardless of database experience — a free, immediate, plain-language explanation of a raw execution plan, for Postgres, SQL Server, and Snowflake at MVP.
2. Pair that explanation with a node-graph visualization that makes the plan's shape and cost distribution legible at a glance.
3. Establish planreader.dev as a credible, well-known top-of-funnel property for @scalingbackend, feeding qualified traffic into pgsuite (Postgres users) and QueryDoc (Snowflake users).
4. Do all of the above without asking for a signup, an email, or a credit card, and without requiring the user to trust a server with their query text unless they explicitly opt into the LLM narrative mode.

## 3. Non-goals

- PlanReader is **not** a database monitoring tool — it never connects to a live database.
- PlanReader is **not** a query rewriter or auto-tuner — it explains a plan, it doesn't rewrite the query that produced it.
- PlanReader is **not** intended to become a standalone revenue product. If a feature request would turn it into one (accounts, paid tiers, team workspaces), the right answer is "that belongs in pgsuite/QueryDoc," not "build it here."
- PlanReader does not aim to be the deepest possible tuning tool for expert DBAs (that's pgMustard's and pganalyze's territory) — it aims to be the most approachable one, with enough depth that experienced users still get value from the visualization even if they skip the plain-language layer.
- PlanReader does not claim to diagnose parameter sensitivity (parameter sniffing on SQL Server, plan instability from Snowflake's dynamic cost-based optimizer) — a single pasted plan is a single snapshot of one execution, and no amount of parsing sophistication changes that structural fact. Where a parameterized query or an unusually-shaped plan is detected, PlanReader states this limitation directly to the user (e.g., "this reflects one specific run — if this query is sometimes fast and sometimes slow, a different plan may be used for different inputs, which a single pasted plan can't show you") rather than implying completeness it doesn't have. This is also a legitimate, low-pressure nudge toward pgsuite/QueryDoc's plan-history capabilities.

## 4. Target personas

**Persona A — "The stuck junior/mid-level developer."** Comfortable writing SQL, has never had to seriously read a plan before, just got told by a senior engineer or a monitoring alert that a query is slow. Pastes the plan somewhere to make sense of it, googling terms like "seq scan bad?" along the way. Wants a plain-English summary first, detail second. This persona is the primary growth driver — they'll share the tool with teammates and reference it in PRs.

**Persona B — "The polyglot backend/data engineer."** This is close to Kiran's own profile — works across Postgres, SQL Server, and Snowflake in the same week, doesn't want to context-switch between three different vendor tools with three different mental models. Values a consistent visualization language across engines more than deep advice on any single one. Natural upgrade path to pgsuite (ongoing Postgres observability) or QueryDoc (Snowflake-native diagnosis) once they need more than a one-off explanation.

**Persona C — "The experienced DBA doing a quick sanity check."** Already knows how to read a plan, but wants a fast visual on an unfamiliar or unusually large plan, or wants to hand a clean visualization to a less experienced teammate instead of a wall of text. Lower priority for the plain-language layer, higher value from the node-graph and clarity of presentation. This persona is the primary reason the Expert-depth toggle and dense side-panel detail exist — Persona A gets the guided walkthrough and collapsed-by-default view, Persona C gets the expanded, technical, no-narration view, from the same underlying data.

## 5. User stories

- As a developer with no formal DB background, I want to paste my raw `EXPLAIN` output and immediately understand which part of my query is slow and why, so I don't have to learn plan syntax just to fix one query.
- As a backend engineer who works across Postgres and Snowflake, I want a consistent visual language for plans regardless of engine, so I don't have to relearn a new tool's conventions every time I switch stacks.
- As a team lead, I want to paste a teammate's plan into something I can screenshot and drop in Slack, so I can explain a performance issue without a screen-share.
- As a privacy-conscious engineer, I want to know for certain that pasting a plan containing real table/column names and filter values doesn't send that data anywhere, so I can use the tool on production plans without going through a security review.
- As a Postgres user who outgrows the free tool, I want a clear, non-pushy next step toward something that watches my database continuously, so I know pgsuite exists when I need it.
- As a Snowflake user who wants AI-narrated, deeper diagnosis than the free rule engine gives, I want a clear path to QueryDoc, so I know where to go next.

## 6. In-scope engines for MVP

Postgres (`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and TEXT), SQL Server (`.sqlplan` / Showplan XML), Snowflake (Query Profile JSON / `GET_QUERY_OPERATOR_STATS()` output). Rationale: these are Kiran's actual production stack, they cover three structurally different plan formats (tree-in-JSON, XML with a published schema, flat table with array/object attributes) which validates the normalization architecture early, and they map directly to the two existing funnel products (Postgres → pgsuite, Snowflake → QueryDoc), with SQL Server serving primarily as a credibility and reach play.

MySQL and any further engines are explicitly Phase 2 (see Feature Prioritization doc).

## 6a. Interactive UI requirements

A visual that can't be explored is barely better than a static screenshot — the visualization is the tool's second core promise (alongside plain-language explanation), so its interactivity is treated as a first-class requirement, not a cosmetic layer added afterward. These stories apply across all three MVP engines, since the interactivity operates on the normalized `PlanNode` model rather than engine-specific data.

- As a beginner opening a large, unfamiliar plan, I want fast/uninteresting subtrees collapsed by default with the ability to expand them, so I'm not confronted with 80 nodes before I've understood anything.
- As any user, I want to hover a node for a quick stat summary and click it for full detail in a side panel, so I can skim quickly or dig deep without the graph itself getting cluttered with dense text.
- As a user working with a plan that has dozens of nodes, I want to search or filter by operator type, table name, or warning severity, so I can jump straight to what matters instead of visually scanning the whole tree.
- As a total beginner, I want an optional guided, step-by-step walkthrough that narrates the plan in execution order, so I have a "hold my hand through this" option the first few times I use the tool.
- As an experienced user (Persona C), I want to switch off the beginner-level narration and see denser technical detail, so the tool doesn't feel like it's talking down to me once I know what I'm doing.
- As a user trying to explain a finding to a teammate, I want to export the current graph view as an image, so I can drop it into Slack or a PR description without needing the full sharing/publish feature.
- As a user comparing the plan to the query that produced it, I want clicking a node to highlight the relevant part of my original query text, so I don't have to mentally map plan structure back onto SQL myself.
- As a keyboard-oriented user, I want to navigate between nodes and trigger search without reaching for the mouse, so the tool is fast to use and consistent with accessibility expectations.

Full acceptance criteria, testing approach, and edge cases for each of these live in the Episodes & Stories document (Episode 6, extended).

## 7. Success metrics

- **Adoption**: unique plans submitted per week, trending upward month over month post-launch; ratio of returning visitors (bookmark/reuse signal) vs. one-time visitors.
- **Engine mix**: distribution across Postgres/SQL Server/Snowflake, to validate or correct the MVP engine prioritization for Phase 2 planning.
- **Funnel conversion**: click-through rate on pgsuite/QueryDoc callouts, and (where traceable) attributed signups/trials on those products originating from planreader.dev.
- **Content performance**: referral traffic from the existing execution-plan video series and blog post, and vice versa — whether PlanReader increases traffic to that existing content.
- **Qualitative**: unprompted mentions/shares on Reddit, Hacker News, or Twitter/X — the kind of organic pickup Depesz and PEV2 got, which would validate that PlanReader has hit the "actually useful enough to recommend" bar.
- **Non-metric but binding constraint**: zero incidents of plan content (containing real schema/data) leaving the browser without explicit, informed user opt-in.

## 8. Explicit non-goals (restated for emphasis)

- No revenue target for planreader.dev itself.
- No feature that requires persistent user identity.
- No live database connectivity, ever, under any feature request.
- No commitment to matching pgMustard's or pganalyze's depth of advice — PlanReader's job is breadth of access (free, multi-engine, no signup), not maximum depth on any one engine.
