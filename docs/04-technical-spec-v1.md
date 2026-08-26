# PlanReader — Technical Specification v1

## 1. Per-engine input formats and parser architecture

### 1.1 Postgres — `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
- **Structure**: A JSON array with one plan object, containing a nested `Plan` tree. Each node has `Node Type`, `Startup Cost`, `Total Cost`, `Plan Rows`, `Plan Width`, and (with `ANALYZE`) `Actual Startup Time`, `Actual Total Time`, `Actual Rows`, `Actual Loops`. `BUFFERS` adds `Shared Hit Blocks`/`Shared Read Blocks` etc. Children live under a `Plans` array on each node — this is already a tree, which makes Postgres the easiest of the three formats to normalize.
- **TEXT format** is also common (copy-pasted from `psql`) and must be supported since many users won't know to ask for JSON — this requires a dedicated line-based parser that reconstructs the tree from indentation and `->` markers, plus regex extraction of the same cost/row/time fields. This is a well-trodden problem (Depesz and PEV2 both do it) but still the single largest parsing-effort item for the Postgres lane.
- **Complexity**: Low-to-medium. JSON path: straightforward recursive descent. TEXT path: moderate, indentation-sensitive parsing, needs a solid test suite built from real-world plan samples (CTEs, subplans, parallel workers, InitPlans all have quirks).

### 1.2 SQL Server — Showplan XML (`.sqlplan`)
- **Structure**: An XML document rooted at `ShowPlanXML`, namespaced at `http://schemas.microsoft.com/sqlserver/2004/07/showplan` (the namespace URI hasn't changed since SQL Server 2005 despite version bumps — < cite index="60-1">the root element contains the Showplan XML namespace attribute and SQL Server build information, and contains batch and statement sub-elements, where each statement carries a StatementText attribute describing the T-SQL query, a StatementId, relative cost, and optimization level</cite>). Below that, `QueryPlan` contains a tree of `RelOp` elements — < cite index="65-1">each `RelOp` node carries attributes like `PhysicalOp`, `LogicalOp`, `EstimateRows`, `EstimateIO`, `EstimateCPU`, `AvgRowSize`, and `EstimatedTotalSubtreeCost`</cite>, with actual runtime stats (when captured from an executed plan) nested inside `RunTimeInformation`/`RunTimeCountersPerThread`.
- **Complexity**: Medium-high. XML with namespaces is more ceremony to parse correctly than JSON (namespace-aware XPath or a proper XML library, not regex), and the operator vocabulary (`PhysicalOp` values) is large and SQL-Server-specific, requiring its own mapping table to the internal plan-tree model. Users will supply this either as a raw `.sqlplan` file upload or pasted XML text — the parser needs to handle both, and needs to tolerate the file being wrapped in Extended Events XML (a common gotcha — < cite index="63-1">the ShowPlanXML node is often not the root of the XML pasted by users, since Extended Events wraps it in additional information</cite>), so the parser should search for the `ShowPlanXML` element rather than assume it's the document root.

### 1.3 Snowflake — Query Profile JSON / `GET_QUERY_OPERATOR_STATS()`
- **Structure**: This is the least tree-shaped of the three natively. < cite index="54-1">`GET_QUERY_OPERATOR_STATS` is a table function that takes a query ID and returns a vaguely tabular result, including OPERATOR_ATTRIBUTES and OPERATOR_STATISTICS objects/arrays that vary by operator type</cite>, with parent/child relationships expressed via ID references rather than nesting (parallel to how the JSON `EXPLAIN` output structures it — < cite index="50-1">operators reference parent operators by id, e.g. `{"id":2,"operation":"Filter","parentOperators":[1]}`</cite>). < cite index="56-1">Execution time is broken down per operator into `overall_percentage`, `initialization`, `processing`, `synchronization`, `local_disk_io`, `remote_disk_io`, and `network_communication`</cite>, and operator-specific stats (IO, DML, external function calls) live in nested objects that differ by operator type.
- **Complexity**: High. This is a flat table with foreign-key-style parent references that must be reconstructed into a tree client-side, a large and growing vocabulary of operator types (Aggregate, CartesianJoin, Filter, TableScan, WindowFunction, WithClause/WithReference for CTEs, etc. — see full list in Snowflake's docs), and per-operator-type attribute schemas that need individual mapping. This is also the format most likely to require server access to obtain in the first place (via `GET_QUERY_OPERATOR_STATS(query_id)`) rather than being something a user can casually copy from a UI — expect to spend real product-copy effort teaching users exactly how to get this JSON out of Snowflake, mirroring pgMustard's "Getting a query plan" doc pattern.

### 1.4 Normalization target — the internal plan-tree model
All three parsers compile down to one shared internal representation:

```
PlanNode {
  id: string
  engine: "postgres" | "sqlserver" | "snowflake"
  operatorType: string          // normalized (e.g. "seq_scan", "index_scan", "hash_join")
  rawOperatorLabel: string      // original engine-specific label, always preserved
  estimatedRows?: number
  actualRows?: number
  estimatedCost?: number
  actualTimeMs?: number
  loops?: number
  children: PlanNode[]
  attributes: Record<string, string | number>   // engine-specific extras, untouched
  warnings: Warning[]           // populated by the rule engine, see §2
}
```
Keeping `rawOperatorLabel` and the full untouched `attributes` bag alongside the normalized fields matters: it means Phase 2 engines (MySQL, etc.) or a Phase 2 "show me the raw engine output for this node" feature never lose information to the normalization step, and it makes the rule engine's job (below) engine-agnostic wherever possible while still allowing engine-specific rules where operator vocabularies diverge too much to unify (e.g. Snowflake's spill/remote-disk-IO breakdown has no clean Postgres or SQL Server equivalent).

Each engine parser is a pure function: `rawPlanText -> PlanNode` (or throws a structured parse error with a "here's what looks wrong" message — this itself is a UX opportunity, since malformed pastes are a top source of first-run frustration in every tool reviewed).

**Parsing robustness is not optional polish — it's a Must-have.** Real-world evidence from existing tools' own issue trackers shows naive parsing fails routinely, not rarely:
- Postgres has shipped JSON plans with duplicate keys (e.g. two `"Workers"` blocks on the same node); a plain `JSON.parse()` silently keeps only one and drops the other, losing data without any visible error. The Postgres JSON parser must be duplicate-key-tolerant (stream-parsing rather than the browser's native `JSON.parse`), matching the fix PEV2 had to make.
- A pre-processing/cleanup pass must run before the real parser sees the text, stripping known copy-paste artifacts: `psql`'s `\x on` mode wraps output in `[ RECORD ]` markers and a `QUERY_PLAN` header; `auto_explain` log capture prepends `LOG:`/timestamp prefixes. Both are extremely common real-world sources of pasted plans, not edge cases.
- The SQL Server XML parser must search the document for a `ShowPlanXML` element rather than assume it's the document root — Extended Events capture (a common export method) wraps it in additional XML, so a root-assuming parser fails on a routine input shape.
- Nodes with `loops > 1` or parallel-worker data need explicit handling: cumulated I/O/duration figures across workers or loop iterations are a documented, unresolved source of user confusion in existing tools (a query can appear ~10x slower than it ran because per-worker times are summed). The rule engine (§2) must label these cases explicitly rather than surface a raw, misleading number.

## 2. Explanation-generation approach

Three options were weighed, per the brief:

| Approach | Cost/request | Latency | Reliability/consistency | Notes |
|---|---|---|---|---|
| Rule-based only (QueryDoc-style signal engine) | Near-zero (client-side compute) | Instant | High — deterministic, testable, no hallucination risk | Ceiling on nuance; can't handle genuinely novel plan shapes gracefully |
| Pure LLM narrative | Real, unpredictable at scale (free public tool = no volume ceiling) | Seconds, network-dependent | Lower — narrative quality varies, risk of confidently wrong explanations on edge cases | Requires server-side processing, breaks the "nothing leaves the browser" promise by default |
| **Hybrid: rules detect, LLM phrases (recommended)** | Rules always run free/client-side; LLM call is opt-in and only fires for the narrative layer | Instant baseline, LLM layer is additive and async | High — the LLM is constrained to *phrasing* already-detected, already-validated facts, not inventing diagnoses | Matches QueryDoc's own architecture, so it's proven internally, and keeps the free/no-signup/client-side default intact |

**Decision: hybrid, rules-first, LLM-optional.** The rule engine is the MVP default and the only mode for the initial launch — it's what makes "no signup, nothing leaves the browser, works instantly" possible, and it's the mode that can absorb unpredictable free-tool traffic without a runaway API bill. Each rule is a small, testable function operating on the normalized `PlanNode` tree (e.g. `flagSeqScanOnLargeTable`, `flagRowEstimateMismatch`, `flagSpillToDisk`, `flagNestedLoopExplosion`), each producing a `Warning` with a severity, a plain-language template, and a link to the relevant existing @scalingbackend blog/video content where one exists.

The LLM narrative mode (Should-have, fast-follow) is additive: once rules have run and produced their structured warnings, an opt-in call sends *only the structured findings plus minimal plan shape* (not necessarily the raw literal-laden plan text) to the Claude API to produce a connected, readable paragraph stitching the findings together — this bounds both cost (small, structured input, not the full raw plan) and hallucination risk (the LLM is phrasing verified facts, not diagnosing from scratch). This is the same pattern QueryDoc already validated with Cortex, so it's a known-working design, not a leap.

## 3. Visualization architecture

**Recommendation: React Flow with dagre for layout, not raw D3 or Mermaid.**

- **Mermaid** is too rigid for this use case — it's great for simple, mostly-static diagrams but doesn't give the interactivity (click-to-expand, hover-for-detail, pan/zoom on large plans) that a plan tree with 50+ nodes needs.
- **Raw D3** offers maximum control but means building interaction, zoom/pan, and node-rendering primitives from scratch — more effort than the project needs when a purpose-built library exists.
- **React Flow** is purpose-built for exactly this kind of interactive node-graph, has first-class React component rendering per node (needed here, since each node needs cost/time/row-mismatch encoded visually, not just a label), and < cite index="79-1">for tree-shaped graphs the React Flow team's own recommendation is to pair it with dagre, which produces a well-organized tree layout with no extra effort</cite>.
- **dagre vs. alternatives**: < cite index="83-1">dagre handles the conversion from its center-based coordinate system to React Flow's top-left system</cite> and is the default recommendation; < cite index="79-1">d3-hierarchy is a lighter option for strict single-root trees but assigns identical width/height to all nodes, which doesn't fit here since node size will vary with cost/row-count encoding</cite>; < cite index="82-1">elkjs is a more powerful alternative worth evaluating if dagre's layout quality proves insufficient on deep or wide plans</cite>, but it's heavier to configure and should only be reached for if dagre's output looks cramped on real-world large plans during testing. **Decision: start with dagre, keep elkjs as a documented fallback if large-plan layouts look poor in testing.**

**Visual encoding scheme:**
- **Node size**: scaled to relative cost or time contribution (whichever the engine best supports — actual time when `ANALYZE`/runtime stats are present, estimated cost otherwise).
- **Node color**: heatmap (cool → warm) for the same cost/time metric, so the visually "hottest" nodes are the ones worth investigating first — matching the mental model Depesz's exclusive-time highlighting already trained the Postgres community to expect.
- **Edge thickness**: proportional to row count flowing between operators, making "one join blew this up" visually obvious without reading numbers.
- **Estimate-vs-actual mismatch**: a distinct border/badge treatment (not just color, to stay colorblind-accessible) on nodes where actual rows diverge sharply from estimated rows — this is one of the single most-requested signals across every tool reviewed (Depesz's "rows x" factor, pgMustard's bad-estimate highlighting).
- **Loop counts**: shown as a small multiplier badge on nodes executed more than once (nested loop inner sides), since loop count is a common source of "why is this node's total time so high" confusion for beginners.

### 3.1 Interactive UI components and implementation notes

The graph is not a static render — interactivity is core to the product, not an enhancement layer, so it's specced alongside the visual encoding rather than deferred:

- **Expand/collapse**: subtree collapse state lives in local component state keyed by node ID, not in the `PlanNode` model itself (keeps the data model pure). Default collapse threshold (e.g. "collapse subtrees below X% of total cost") is a tunable constant, not hardcoded per engine.
- **Pan/zoom/fit-to-view**: React Flow provides pan/zoom natively; "fit to view" uses its `fitView()` API, triggered both on initial load and via a visible reset control (large plans should never load pre-zoomed to an unreadable scale).
- **Hover tooltip vs. click detail panel**: tooltip is a lightweight, non-interactive summary (a handful of key stats); the click-triggered side panel is a separate, richer component that renders the full normalized fields plus the raw `attributes` bag and any `Warning[]` for that node — keeping these as two distinct components (not one that just gets bigger) keeps the hover path fast and cheap to render.
- **Search/filter**: implemented as a derived filter over the existing node/edge state (matching against operator type, `rawOperatorLabel`, table/relation name where present, and warning severity) — matching nodes are highlighted, non-matching nodes are dimmed (opacity reduced) rather than removed from the DOM, so overall tree shape and context are never lost mid-search.
- **Encoding legend toggle**: a small control bound to the same size/color scaling function already used for rendering — switching the toggle re-runs the existing scale function against a different metric (cost/time/rows) rather than requiring parallel rendering logic per encoding.
- **Guided walkthrough mode**: a linear ordering of nodes (inside-out execution order, matching standard plan-reading convention) drives a "next/previous" narration UI that reuses the same `Warning[]` and summary text already generated by the rule engine (Episode 5) — this must not become a second content-authoring surface; it's a different *presentation* of data that already exists.
- **Beginner/Expert toggle**: a display-mode flag that controls verbosity of rendered warning text (short plain-language vs. fuller technical phrasing) — both phrasings should be generated from the same rule output at authoring time (each `Warning` carries both a short and a long form), not computed live, to keep the rule engine's output deterministic and testable.
- **Node-to-query-text correlation**: requires the original query text to be available (either pasted alongside the plan, or embedded in the plan itself where the format includes it, e.g. `Query Text` in some Postgres captures or `StatementText` in SQL Server XML). Where query text isn't available, this feature simply doesn't activate for that node — it's additive, not a hard dependency for core functionality.
- **Keyboard navigation**: standard focus-management patterns (arrow keys move a "current node" pointer through the tree, `Enter`/`Space` opens the detail panel, `/` focuses the search input, `Escape` closes overlays) — implemented and tested as its own concern, not assumed to fall out of mouse-oriented component design for free.
- **Image export**: render the current graph view to canvas/SVG and trigger a download (a well-established browser pattern, no server round-trip needed) — keeps this feature inside the "fully client-side" privacy architecture described in §6.
- **Theme toggle**: implemented via CSS custom properties / design tokens from the start (per the frontend-design conventions used elsewhere in the stack) so dark/light isn't a late retrofit requiring a full styling pass.

## 4. Recommended tech stack

- **Frontend**: React + TypeScript, React Flow (`@xyflow/react`) + `@dagrejs/dagre` for the graph, static-site-friendly framework (e.g. Vite or Next.js in static export mode) so the rule-based path can genuinely run fully client-side with no backend round-trip.
- **Parsing/rule engine**: Pure TypeScript, runs in-browser (also reusable as an npm package or CLI later if that's ever wanted) — no server dependency for the MVP's core promise.
- **Backend (only for opt-in LLM mode and optional plan publishing)**: Minimal API surface — one endpoint to accept structured findings + plan shape and call the Claude API, one endpoint (Should-have) to persist an opted-in published plan for sharing. Lightweight runtime (e.g. a small Node/Edge function) rather than a full application server, since the surface area is intentionally tiny.
- **Hosting**: Static hosting/CDN for the frontend (near-zero marginal cost at any realistic traffic level); serverless functions for the two optional backend endpoints, which only incur cost when someone opts in.
- **Domain**: planreader.dev primary, planreader.app configured as a redirect-only safety net (already secured, no further action needed here).

## 5. Hosting/cost estimate

Because the MVP's core path is 100% client-side static compute, the dominant cost driver is CDN/static hosting bandwidth, which is cheap-to-free at realistic top-of-funnel traffic volumes (comparable to hosting the existing @scalingbackend blog). The only variable, volume-sensitive cost is the opt-in LLM narrative mode, which is why it's designed to be gated behind an explicit user action rather than running automatically on every submission — this keeps the free public tool's worst-case cost bounded by *opt-in* volume, not total traffic, and keeps it defensible as a genuinely free, unlimited-use tool for the rule-based path regardless of how much the tool goes viral.

**No plan-count limit, by architecture, not by policy.** Every competitor reviewed that offers a free tier meters it somehow — pgMustard caps the free trial at five real plans, EverSQL's cheapest paid tier caps at 10 optimizations/month. Because PlanReader's rule-based path costs nothing per additional plan (it's the user's own browser doing the work), "unlimited, forever, free" is a structural fact of the design, not a promise that could quietly change later — worth stating as a small trust signal directly in the product UI, not just implied by the absence of a paywall.

## 6. Privacy / data-handling approach

- **Rule-based path (default, MVP)**: Parsing, normalization, rule evaluation, and rendering all happen in the browser. The pasted plan text never leaves the client. This is technically feasible because every step described in §1–3 is pure computation over text/JSON/XML the user already has — there's no reason any of it needs a server round-trip, unlike PEV2's hosted mode which stores server-side by default for sharing convenience.
- **What has to happen server-side (LLM mode only)**: The opt-in Claude API call. To minimize what's transmitted, the client sends the *structured rule-engine findings* (operator types, severities, relative costs) rather than the raw plan text wherever the findings are sufficient to generate a good narrative — literal query text, table/column names, and filter values stay client-side unless a future feature explicitly needs them and the user explicitly opts in a second time.
- **Messaging discipline**: PEV2's experience is the cautionary tale here — < cite index="6-1">even a tool capable of purely local storage lost user trust because the hosted default stored plans server-side and the tool failed to make that clear enough to a skeptical user</cite>. PlanReader's UI must state the privacy stance in plain language directly above the paste box (not just in a footer/docs page), and any mode that does send data server-side must require an explicit, separately-labeled opt-in click — never a pre-checked default.
- **Optional publish/share feature (Should-have)**: Modeled on pgMustard's approach — < cite index="21-1">publishing is opt-in and per-plan, with an explicit warning to double-check for sensitive data before publishing</cite>. PlanReader should carry the same warning at the point of publish, not just in documentation.
