# PlanReader — Feature Prioritization (MoSCoW)

## Must have (MVP — planreader.dev v1)
- Paste-box input for raw plan text/JSON, auto-detecting engine (Postgres TEXT/JSON, SQL Server `.sqlplan`/XML, Snowflake `GET_QUERY_OPERATOR_STATS` JSON or Query Profile JSON export).
- Client-side parsing and rendering for the rule-based path — nothing leaves the browser unless the user explicitly opts into LLM narrative mode.
- Normalized internal plan-tree model shared across all three MVP engines.
- Node-graph visualization (dagre-based layout via React Flow) with:
  - Node size or color encoding relative cost/time.
  - Estimate-vs-actual row mismatch highlighting (Postgres/SQL Server; Snowflake where available).
  - Edge thickness or label for row counts flowing between operators.
- Rule-based plain-language explanation for the most common, well-understood problems per engine (seq scans on large tables, bad row estimates, spills, missing index opportunities, nested loop blowups, exploding joins).
- "What am I looking at" mode for total beginners — a one-paragraph summary of what the query is doing overall, before the node-level detail.
- No signup, no account, no rate-limit wall for the rule-based path.
- Mobile-usable landing page and clear positioning (see positioning brief) so the tool is unmistakable within seconds.
- Explicit non-storage privacy statement above the paste box, not buried in a footer link.
- Light funnel touchpoints: contextual callouts (not popups) pointing Postgres users to pgsuite and Snowflake users to QueryDoc when the free explanation hits its ceiling (e.g., "Want ongoing checks like this across your whole database? → pgsuite").
- Basic analytics (privacy-respecting, aggregate only — no plan content ever logged) to learn which engines and problem types get the most use.
- **Tolerant input parsing, not naive parsing.** Real-world plans routinely break naive parsers: Postgres has shipped JSON with duplicate keys (e.g. two `"Workers"` blocks) that silently loses data under a plain `JSON.parse()`; `psql`'s `\x on` mode and `auto_explain` log capture both wrap plan text in artifacts (`[ RECORD ]` markers, `LOG:`/timestamp prefixes) that a naive parser chokes on; SQL Server's `ShowPlanXML` element is frequently not the document root because Extended Events wraps it in additional XML. PlanReader needs a duplicate-key-tolerant JSON parser, a pre-processing cleanup pass that strips known copy-paste artifacts, and an XML parser that searches for `ShowPlanXML` rather than assuming it's the root — from day one, not as a bug-fix cycle after launch.
- **Explicit labeling of parallel/looped timing figures.** Cumulated I/O and duration figures across parallel workers or repeated loops are a well-documented, still-unresolved source of confusion in existing tools (a query can display as 10x slower than it actually ran because per-worker times are summed rather than shown per-worker or as a max). Any node with `loops > 1` or parallel worker data must carry an explicit note distinguishing cumulated vs. per-execution time, as a named rule in the MVP rule set for all three engines.
- **Parameter-sensitivity honesty note.** A single pasted plan is a single snapshot and cannot by itself diagnose parameter sniffing (SQL Server) or plan instability from Snowflake's dynamic optimizer. When a parameterized query or an unusually shaped plan is detected, PlanReader should say so in plain language rather than implying the pasted plan is the whole story — see PRD non-goals for the exact framing.
- **Core interactive graph controls.** Pan/zoom with a "fit to view" reset button; click-to-expand/collapse on any subtree, with fast/cheap subtrees collapsed by default (matching pgMustard's pattern) so a beginner isn't overwhelmed by a wall of nodes on first load; hover tooltips showing the key stats for a node without requiring a click.
- **Node detail panel.** Clicking a node opens a side panel with its full stat breakdown (all normalized fields plus the untouched raw `attributes` bag) and its plain-language warnings — the graph stays the primary at-a-glance view, the panel is where depth lives.
- **Search and filter.** A search/filter bar that can find nodes by operator type, table/relation name, or warning severity, dimming non-matching nodes rather than hiding them (so tree shape/context is never lost while filtering).
- **Encoding legend toggle.** A visible, switchable legend letting the user choose what node size/color encodes (relative cost, actual time, or row count) rather than a single fixed encoding — different questions call for different lenses, and this is cheap to build once the underlying metrics are already normalized.

## Should have (fast-follow, weeks after launch)
- Optional LLM-generated narrative mode (hybrid: rules detect issues, LLM phrases them), clearly labeled as sending plan text to a server, with a one-click toggle to stay rules-only.
- Shareable, opt-in links (like PEV2's) for a specific parsed plan — off by default, plan data server-stored only when explicitly published.
- "Explain this operator" hover/click detail cards linking back to the existing @scalingbackend blog post and video series for the concept behind each operator type.
- Side-by-side diff view for comparing two plans (before/after an index change) — a frequently requested feature across every competitor reviewed.
- Downloadable/exportable plan summary (PDF or shareable image) for pasting into a PR description or Slack thread.
- Example plan library (like pgMustard's) so people can try the tool with zero setup.
- **Guided walkthrough mode.** A "walk me through it" step-by-step tour that advances through nodes in execution order (inside-out, per the standard reading convention), narrating what's happening and why at each step — this is the single most beginner-friendly interactive feature reviewed competitors don't offer, and it reuses the same rule-engine warnings already generated for the graph/panel view.
- **Beginner/Expert explanation depth toggle.** A simple switch that shows either the short plain-language summary (default) or the fuller technical detail per warning — serves Persona A and Persona C from the same underlying data without maintaining two separate content tracks.
- **Mini-map / overview panel** for large plans (React Flow ships a `MiniMap` component for this) so orientation isn't lost when zoomed into a large tree.
- **Timeline/Gantt-style alternate view.** A toggle between the node-graph and a simple horizontal bar view of per-operator time (mirroring pgMustard's timing bar) — some questions ("what's actually taking the time") are answered faster by a timeline than a tree shape.
- **Node-to-query-text correlation.** Clicking a node highlights the corresponding clause in the original submitted query text (when available) — every competitor that's attempted this calls their own version "rudimentary," so doing it well is a genuine, achievable differentiator.
- **Keyboard navigation.** Arrow keys to move between nodes, `/` to focus search, `?` to open a shortcuts overlay — meaningful both for accessibility and for the "power user doing a quick sanity check" persona who doesn't want to reach for a mouse.
- **Export current view as an image.** One-click PNG/SVG export of the graph for pasting into a Slack thread or PR description, without needing the Should-have sharing/publish-link feature to be built first.
- **Dark/light theme toggle.** Low-effort, frequently requested in adjacent tools (explicitly called out as a wish in Snowflake UI reviews), and free once a design-token-based styling approach is in place.
- **Adjustable warning-sensitivity threshold.** A simple slider/toggle to show only high-severity findings vs. everything the rule engine detected — lets an expert quiet the noise without the tool needing two separate "modes" to maintain.

## Could have (Phase 2+)
- MySQL support (`EXPLAIN FORMAT=JSON`).
- Additional engines as demand justifies (MariaDB, Oracle, CockroachDB — all use meaningfully different plan formats and would need dedicated parser work).
- Historical plan tracking / regression detection (this starts to overlap with pganalyze's and pgMustard's paid territory — a natural place to say "that's what pgsuite/QueryDoc are for" rather than build it here).
- Browser extension or CLI companion for piping `EXPLAIN` output straight in.
- Auto-anonymization/obfuscation of literal values and identifiers before optional server-side LLM processing (differentiator, but real engineering effort — sequence this after the LLM mode ships and proves demand).
- API endpoint so other tools (e.g., ORMs, CI pipelines) can call the rule engine programmatically.
- **Embeddable widget.** An iframe-embeddable version of a specific published plan (depends on the Should-have publish feature) so a blog post or docs page can inline a live, interactive plan rather than a static screenshot — directly useful for the existing @scalingbackend content pillar.
- **Side-by-side diff with synced interaction.** Building on the Should-have diff view: synchronized pan/zoom/expand-state between the two plans being compared, so scrolling one scrolls the other — nice-to-have polish on top of the core diff capability, not required for diffing to be useful.

## Out of scope for the foreseeable future
- Live database connections of any kind (this stays strictly a paste-a-plan tool — connecting to a database is pgsuite's job, not PlanReader's, and it's also the single biggest trust/security liability a public no-signup tool could take on).
- Query rewriting or auto-fix suggestions (that's EverSQL's lane, not this tool's).
- User accounts, saved history tied to identity, or any paid tier on planreader.dev itself — if this tool ever needs a business model, that's a sign the roadmap drifted from "funnel" toward "product," and the right response is to move that feature into pgsuite/QueryDoc instead.
- Team/collaboration features (shared workspaces, comments) — out of scope by design, since that pulls PlanReader toward being a standalone SaaS rather than a funnel.
