# PlanReader — Episodes & User Stories

This translates the PRD, Technical Spec, MoSCoW prioritization, and the additional-limitations findings into buildable units of work. Each **episode** (epic) groups related user stories; each story carries acceptance criteria, a testing approach, and an explicit edge-case list drawn from real-world failures found in competitor tooling (see `07-additional-tool-limitations.md`) plus standard boundary analysis. Episodes are ordered roughly in build sequence, matching the Must-have → Should-have → Could-have priority from the MoSCoW doc.

---

## Episode 1 — Postgres plan ingestion

**Goal**: Reliably turn raw Postgres `EXPLAIN` output (TEXT or JSON, with or without `ANALYZE`/`BUFFERS`) into the internal `PlanNode` tree.

### Story 1.1 — Parse well-formed JSON plans
As a user, I want to paste `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` output and have it parsed correctly, so I get an accurate visualization.

**Acceptance criteria**
- Nested `Plans` arrays convert to a correct `PlanNode` tree of matching depth and order.
- All standard fields map: `Node Type`, `Startup/Total Cost`, `Plan Rows`, `Plan Width`, `Actual Startup/Total Time`, `Actual Rows`, `Actual Loops`, buffer stats.
- Missing `ANALYZE` fields (estimate-only plans) don't crash the parser — `actualTimeMs`/`actualRows` are simply absent on the node.

**Testing approach**
- Unit tests against a fixture library of real plans: simple scans, multi-way joins, CTEs, window functions, parallel queries, partitioned tables, recursive CTEs.
- Property-based test: any valid nested JSON plan of random depth/branching parses without throwing and preserves node count.
- Golden-file regression tests: snapshot the parsed tree for each fixture and diff on every change to the parser.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Duplicate JSON keys (e.g. two `"Workers"` blocks on one node) | Native `JSON.parse()` silently drops one, losing data with no error | Use a duplicate-key-tolerant/stream parser (not native `JSON.parse`); merge or preserve both |
| `BitmapAnd`/`BitmapOr` nodes always reporting `actual rows = 0` | Known Postgres quirk, not a real problem — a naive rule would wrongly flag it | Rule engine must special-case these node types and suppress the mismatch warning |
| CTE referenced multiple times (`CTE Scan` nodes) | Shared subtree referenced from multiple places — naive tree copy can double-count cost | Detect shared CTE references, represent once, link additional occurrences rather than duplicating |
| Parallel workers / `Workers Launched`, `Worker Number` | Cumulated timings across workers can look 5–10x worse than reality (documented PEV2 issue) | Explicit "cumulated across N workers" label on affected nodes, don't present raw sum as plain duration |
| `InitPlan` / `SubPlan` nodes | Not part of the main tree flow, easy to misplace visually | Render as clearly distinct (e.g. dashed edge, side branch) from the main execution path |
| Very deep/wide plans (100+ nodes) | Browser layout and rendering performance | Virtualize rendering, collapse subtrees by default below a size/depth threshold |
| Missing `ANALYZE` (estimate-only EXPLAIN) | No actual time/rows — can't do estimate-vs-actual comparison | Rule engine falls back to estimate-only rules, UI clearly labels "no actual run data" |
| Empty plan (single node, trivial query) | Degenerate case | Still renders correctly with minimal chrome, no crash |
| Truncated/incomplete paste (user copied only part of the output) | Very common real mistake | Detect unbalanced brackets/incomplete JSON, surface a specific "looks like this got cut off" error rather than a generic parse failure |
| Non-plan text pasted (user pastes the SQL query itself, or unrelated text) | Common misclick | Detect absence of any recognizable plan structure, return a friendly "this doesn't look like a plan" message rather than a crash or a blank screen |

### Story 1.2 — Parse well-formed TEXT plans
As a user who ran plain `EXPLAIN ANALYZE` in `psql` without `FORMAT JSON`, I want the tool to still work, so I don't need to know about format flags first.

**Acceptance criteria**
- Indentation- and `->`-based tree reconstruction matches the JSON parser's output shape for equivalent plans (cross-validated on the same query).
- Cost/row/time/loop figures extracted via robust pattern matching, not brittle fixed-position string slicing.

**Testing approach**
- Parity tests: run the same query through both `FORMAT JSON` and TEXT, assert the resulting `PlanNode` trees are structurally equivalent.
- Fuzz test with randomly reformatted whitespace/line-wrapping to check indentation-parsing resilience.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `psql \x on` output (`[ RECORD ]` markers, `QUERY_PLAN` header) | Very common copy-paste habit, breaks naive line parsing | Pre-processing cleanup pass strips these before the real parser runs |
| `auto_explain` log-captured output (`LOG:`/timestamp prefixes, surrounding log noise) | Common source for intermittent-slow-query captures | Cleanup pass strips log prefixes; tolerate the known `auto_explain` JSON-shape quirks separately from standard `EXPLAIN` JSON |
| Mixed line endings (CRLF from Windows tools pasted into a Mac/Linux-rendered browser) | Can break indentation-sensitive parsing | Normalize line endings before parsing |
| Trailing/leading whitespace, extra blank lines | Common paste artifact | Trim and collapse before structural parsing |
| Non-English decimal separators (locale-formatted numbers, e.g. `1.234,56`) | Some tools/locales format numbers differently | Detect and normalize, or explicitly flag "couldn't parse this number" rather than silently misreading it |
| Query text embedded in the plan containing literal `->` characters (e.g. in a string literal or comment) | Could be mistaken for tree-structure markers | Structural parser must only treat `->` as a tree marker in the expected column position, not anywhere in text |

---

## Episode 2 — SQL Server plan ingestion

**Goal**: Parse Showplan XML (`.sqlplan` file or pasted XML) into the same internal `PlanNode` model.

### Story 2.1 — Parse `.sqlplan` / Showplan XML
As a SQL Server user, I want to paste or upload my execution plan XML and get the same quality of output as Postgres users get.

**Acceptance criteria**
- Namespace-aware XML parsing correctly locates `ShowPlanXML` regardless of what wraps it.
- `RelOp` tree correctly reconstructed with `PhysicalOp`, `LogicalOp`, `EstimateRows`, `EstimatedTotalSubtreeCost`, and (when present) `RunTimeInformation` mapped to the internal model.
- A mapping table translates SQL-Server-specific `PhysicalOp` values to normalized `operatorType` equivalents used elsewhere in the app (e.g. `Clustered Index Scan` → `index_scan`).

**Testing approach**
- Fixture library covering common operator types (scans, seeks, joins — nested loop/hash/merge, sorts, key lookups, parallelism operators).
- Unit tests specifically targeting the "not at document root" case using real Extended-Events-wrapped exports.
- Cross-version fixtures (SQL Server 2016 through 2022+) since the schema has stayed largely stable but capture tooling varies.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `ShowPlanXML` wrapped inside Extended Events XML, not at document root | Very common export method; a root-assuming parser fails outright | Search the document tree for the `ShowPlanXML` element rather than assuming root position |
| File upload vs. pasted text | Users get plans both ways (native `.sqlplan` file, or copy-pasted XML text) | Support both input paths into the same parser |
| Missing `RunTimeInformation` (estimated plan only, not actual) | No runtime stats available | Fall back gracefully to estimate-only display and rules, same pattern as Postgres |
| Parallelism operators (`Parallelism`/`Gather Streams`) and per-thread `RunTimeCountersPerThread` | Multiple thread-level stat blocks per operator, easy to misrepresent as a single figure | Aggregate clearly-labeled (e.g. "across N threads"), don't silently sum without indicating it |
| Multiple statements/batches in one paste | A `.sqlplan` capture can contain more than one statement | Detect multiple `Statement` elements, let the user pick which one to visualize (or show both) rather than silently only parsing the first |
| Missing-index recommendation blocks embedded in the XML | Present in many real exports, easy to ignore entirely | Surface these as a distinct, clearly-labeled section rather than dropping the information |
| Namespace declared without a prefix vs. with a prefix (`xmlns=` vs `xmlns:p=`) | Both forms appear in real-world exports (seen in different Microsoft docs/tools) | Parser must handle both default and prefixed namespace declarations |
| Malformed/truncated XML (unclosed tags from a bad copy-paste) | Common paste failure mode | Specific "this XML looks incomplete" error, not a generic parser crash |

---

## Episode 3 — Snowflake plan ingestion

**Goal**: Parse `GET_QUERY_OPERATOR_STATS()` output (or exported Query Profile JSON) into the internal model, reconstructing a tree from flat, ID-referenced rows.

### Story 3.1 — Parse operator-stats JSON/table output into a tree
As a Snowflake user, I want to paste the output of `GET_QUERY_OPERATOR_STATS()`, so I don't need Snowsight access to get an explanation.

**Acceptance criteria**
- Flat rows with `id`/`parentOperators` (or `parent`) references correctly reconstruct into a nested tree.
- `OPERATOR_ATTRIBUTES` and `OPERATOR_STATISTICS` objects are mapped per operator type into the internal model's `attributes` bag, with the well-understood ones (IO, execution time breakdown) promoted to normalized fields.
- Execution time breakdown (`initialization`, `processing`, `synchronization`, `local_disk_io`, `remote_disk_io`, `network_communication`) is preserved and available to the rule engine, not just the aggregate percentage.

**Testing approach**
- Fixture library built from real operator vocabulary (Aggregate, Filter, TableScan, Join variants, WindowFunction, WithClause/WithReference for CTEs, UnionAll).
- Explicit test for multi-parent operators (`WithClause` can have multiple `parentOperators`) to confirm the tree-reconstruction logic handles non-strict-tree references (shared CTE reuse) without breaking or infinite-looping.
- Round-trip test: given a known operator list with IDs 1..N and parent references, assert the reconstructed tree has exactly the expected shape.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Multiple `parentOperators` on one node (CTE referenced from more than one place) | Not a strict tree — Snowflake's own docs show `WithClause` with parents `[3,8]` | Represent as a DAG internally where needed, or explicitly link shared references in the visualization rather than forcing a strict tree and silently breaking one branch |
| Operator-specific attribute schemas that vary by `operation` type | A `Filter`'s attributes differ entirely from a `TableScan`'s or an `ExternalFunction`'s | Per-operator-type attribute mapping table, with an "unknown operator type" fallback that still renders raw attributes rather than dropping them |
| Redacted query text (`<redacted>` shown to non-owning users/service accounts) | Common in real organizational exports, per Snowflake's query-redaction feature | Detect and display cleanly ("query text redacted by account policy") instead of treating it as literal query content or crashing |
| Spill-to-local-disk / spill-to-remote-disk stats | Important performance signal, easy to miss since it's nested under IO details | Explicit rule: flag spill as a first-class warning, not buried in raw attributes |
| Very large/high-partition-count `TableScan` operators (tens of thousands of partitions) | Common in real Snowflake workloads on big tables | Large-number formatting (not raw digit strings), and don't let partition-count displays break node sizing in the visualization |
| Getting the JSON out of Snowflake in the first place is non-trivial (requires running a function with a query ID, not a UI copy-paste) | Users may paste malformed or partial output from trying to get this manually | Clear input instructions in-product (mirroring pgMustard's "Getting a query plan" doc pattern), plus tolerant parsing of common near-miss formats (e.g. pasted as a result-grid export with extra column headers) |
| Empty/near-empty result (query ID typo'd, or stats not yet available for a very recent query) | Real first-run failure mode | Distinguish "empty valid input" from "couldn't parse" with a specific, helpful message |
| A near-miss export gives each row a singular parent reference (`parentOperatorId`, one id) instead of Snowflake's own plural/array `PARENT_OPERATORS` | Found via manual testing — every row silently looked parentless, producing N disconnected "root" nodes instead of the real tree, with no error raised at all | `parseRawRows`'s parent-id alias list accepts a singular `parentOperatorId`/`parent_operator_id` the same way it already accepts a bare scalar under `parent` — `coerceIdList` already normalizes either shape into a one-element list |
| A near-miss export has no separate `statistics`/`operatorStatistics` container — row/time figures sit as plain sibling fields on the row itself | Found via the same manual test — every node's `actualRows` came back `undefined`, silently, since the (empty) `statistics` object was found but had nothing in it | When the recognized statistics container is empty, fall back to the row's own unclaimed fields (everything not already read as id/operation/parent/attributes/time-breakdown) as ad hoc statistics — generic, not tied to guessing any one field's exact name |
| An `operatorType` string that LOOKS plausible but isn't real Snowflake vocabulary (e.g. `"HashJoin"` — Snowflake only ever reports a generic `"Join"`, no algorithm split, per this parser's own `operatorMap.ts` comment) | Confidently mapping an unverified operator name would encode a wrong belief into the taxonomy permanently | Deliberately NOT added to `DIRECT_MAP` — correctly falls through to `operatorType: "unknown"` and the honest "we don't have a detailed explanation for this operator yet" fallback, which is the correct behavior for an operator name this product has no way to confirm is real |

---

## Episode 4 — Normalization layer

**Goal**: A single, engine-agnostic `PlanNode` model and operator-type taxonomy that all three parsers compile down to, without losing engine-specific detail.

### Story 4.1 — Normalized operator taxonomy
As a developer of the rule engine, I want a consistent `operatorType` vocabulary across engines, so rules like "flag a full scan on a large table" can be written once and applied to Postgres `Seq Scan`, SQL Server `Table Scan`/`Clustered Index Scan`, and Snowflake `TableScan` alike.

**Acceptance criteria**
- A documented mapping table exists per engine, translating native operator labels to normalized types (`seq_scan`, `index_scan`, `index_only_scan`, `hash_join`, `nested_loop_join`, `merge_join`, `sort`, `aggregate`, `filter`, etc.), with an explicit `unknown` fallback for anything unmapped.
- `rawOperatorLabel` and the full untouched `attributes` bag are always preserved alongside normalized fields — normalization never discards information.

**Testing approach**
- Unit tests: every operator type appearing in the fixture libraries from Episodes 1–3 must resolve to a known normalized type or the explicit `unknown` fallback (never throw).
- Coverage tracking: maintain a running list of "seen but unmapped" operator labels surfaced during testing/beta, so gaps are visible rather than silent.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| New/rare operator type not in the mapping table (e.g. a newer Snowflake operator, or an uncommon SQL Server physical op) | Vocabulary will keep growing over time as engines add features | `unknown` fallback still renders the node with its raw label and attributes, never crashes or silently disappears |
| Operator types that exist in one engine with no equivalent elsewhere (e.g. Snowflake's `Flatten`, Postgres's `WindowAgg` vs SQL Server's `Window Spool`) | Forcing a false equivalence would produce misleading unified rules | Rules can be engine-specific where operator vocabularies genuinely diverge; normalization doesn't force unification where it would be inaccurate |

---

## Episode 5 — Rule engine & plain-language explanations

**Goal**: A library of small, testable, deterministic rules operating on the normalized `PlanNode` tree, each producing a `Warning` with severity, plain-language text, and (where relevant) a link to existing @scalingbackend content.

### Story 5.1 — Core Must-have rule set
As a beginner, I want the tool to point out the specific problems in my plan in plain English, so I don't have to interpret raw numbers myself.

**Acceptance criteria**
- Rules implemented for MVP: sequential/full scan on a large table, bad row estimate (estimate vs. actual mismatch beyond a threshold), disk spill, nested loop join blowup (high loop count with high per-loop cost), exploding join (output rows far exceeding input rows), missing/unused index opportunity signal where derivable.
- Each rule is a pure function `PlanNode -> Warning[]`, independently unit-testable.
- Rules that would misfire on known-benign patterns (see edge cases) are explicitly suppressed.

**Testing approach**
- Unit tests per rule: known-bad fixture triggers the warning, known-good fixture does not (both directions matter equally — false positives erode trust as much as missed detections).
- Snapshot tests on full fixture plans: assert the exact set of warnings produced, to catch unintended regressions when rules are tuned.
- Manual review pass with a working DBA lens (Kiran) on a batch of real anonymized plans before launch, checking that advice reads as genuinely useful, not just technically correct.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `BitmapAnd`/`BitmapOr` nodes with `actual rows = 0` | Known benign Postgres quirk — naive mismatch rule would falsely flag every one | Explicit suppression for these node types |
| Cumulated parallel-worker timings | Could trigger a false "this node is extremely slow" warning when the real per-execution time is fine | Rule must use per-worker/normalized time where available, and always label cumulated figures explicitly when raw sums are the only data available |
| Small tables where a seq/full scan is actually the correct, fastest choice | A blanket "seq scan = bad" rule is wrong and a well-known beginner misconception this tool should actively correct, not reinforce | Threshold the rule on table size/row count, not presence of the scan type alone |
| Parameterized queries / plans that look unusually shaped for their apparent purpose | Single-snapshot limitation (see PRD non-goals) | Detect signals of parameterization where possible and attach the parameter-sensitivity honesty note rather than a false-confidence diagnosis |
| Estimate-only plans (no `ANALYZE`) | No actual data to compare against | Rules relying on actual-vs-estimate must gracefully no-op rather than crash or produce a warning with missing data |
| Extremely large or NaN/negative cost values (malformed or synthetic test data) | Defensive coding needed against garbage input | Rules must not throw on unexpected numeric edge values; treat as "insufficient data" rather than propagate `NaN` into user-facing text |
| Multiple warnings on the same node from different rules | Could overwhelm a beginner with a wall of text | Prioritize/rank warnings by severity, cap the number shown by default with an option to expand |

### Story 5.2 — "What am I looking at" top-level summary
As a total beginner, I want a one-paragraph plain-English summary of the whole plan before I dig into individual nodes.

**Acceptance criteria**
- Summary synthesizes the highest-severity 1–3 findings into a coherent paragraph, not just a concatenated list of warnings.
- Summary degrades gracefully to "this plan looks straightforward, no major issues detected" when no significant warnings fire.

**Testing approach**
- Manual/qualitative review: have a non-DBA read summaries against a batch of fixture plans and confirm they're actually understandable, not just technically accurate.
- Regression snapshot tests to catch unintended wording changes.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Zero warnings fired | Shouldn't read as an error or empty state | Positive, reassuring "looks fine" message, not a blank section |
| Conflicting or overlapping warnings (e.g. both a scan warning and a join warning on interacting nodes) | Naive concatenation reads confusingly | Summary logic should recognize related warnings and synthesize, not just list |

---

## Episode 6 — Node-graph visualization

**Goal**: Interactive React Flow + dagre-based rendering of the plan tree with cost/time/row-mismatch encoding.

### Story 6.1 — Render the plan tree with cost/time encoding
As a user, I want to see the plan as a visual tree where the "hot" nodes are immediately obvious.

**Acceptance criteria**
- Node size and color scale with the relevant cost/time metric (actual time when available, estimated cost otherwise).
- Edge thickness scales with row count flowing between operators.
- Estimate-vs-actual mismatch shown via a distinct, colorblind-safe badge/border, not color alone.
- Loop-count multiplier badge shown on nodes executed more than once.

**Testing approach**
- Visual regression tests (snapshot rendering) across the fixture library, covering small/simple through large/complex plans.
- Manual accessibility check: color-only encoding is never the sole signal (verify with a colorblindness simulator).
- Performance testing: render time and interaction responsiveness (pan/zoom) benchmarked against plans with 10, 100, and 500+ nodes.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Extremely large plans (500+ nodes) | Naive rendering can freeze the browser tab | Virtualize/collapse by default beyond a size threshold; dagre layout quality should be re-checked at this scale, with elkjs as a documented fallback if layout looks cramped |
| Zero-cost or zero-row nodes (legitimate in some cases, e.g. `Result` nodes) | Size/color scaling can break (division by zero, degenerate node size) | Floor values, don't let zero-metrics collapse a node to invisible or throw a layout error |
| CTEs/subplans referenced from multiple places (Postgres `CTE Scan`, Snowflake multi-parent `WithClause`) | Not a strict tree — naive rendering either duplicates the subtree or breaks | Render shared references distinctly (e.g. a linking indicator) rather than forcing a duplicate copy that misrepresents cost |
| Mobile/narrow viewport rendering | The product must be usable from a phone (per positioning brief mobile-usability requirement) | Test dagre layout and pan/zoom interaction specifically at mobile widths, not just desktop |
| Single-node plans (trivial queries) | Degenerate case for a layout engine built for trees | Still renders cleanly, no layout engine errors on a 1-node graph |

### Story 6.2 — Rich node detail panel with operator glossary

**Goal**: When a node is clicked, the detail panel becomes the tool's single best differentiator — not just a dump of raw stats, but a genuine explanation of *what this operator is*, *what this specific node's numbers mean*, and *why it matters here*. This is where "eliminate the limitations found in every competitor reviewed" concentrates: node-to-query correlation that every existing tool calls "rudimentary," the cumulated-timing confusion no tool labels clearly, and the beginner-vs-expert gap no single tool bridges.

As a beginner, I want clicking a node to explain what that operator type actually *is* in plain language, not just show me its numbers, so I can learn while I debug instead of having to look the term up elsewhere.

As any user, I want the panel to clearly separate "what this operator generally means" from "what's notable about *this specific node*," so I don't confuse general education with a diagnosis of my actual problem.

As a user looking at a node with `loops > 1` or parallel-worker data, I want the panel to show both the raw cumulated figure and the per-execution figure side by side, explicitly labeled, so I never have to wonder which number is the "real" one.

**Panel structure (in display order)**
1. **Header**: normalized display name + `rawOperatorLabel` + engine badge (so a user always sees both the friendly name and exactly what their engine called it).
2. **What this does**: 1–2 sentence plain-language definition from the operator glossary (see below), expandable to a fuller paragraph. Collapsed by default in Beginner mode, expanded by default in Expert mode.
3. **This node's numbers**: a stats table — estimated vs. actual rows (with the percentage deviation highlighted if it crosses the mismatch threshold used by the rule engine), cost (startup/total, where the engine has a comparable concept), time, loop count, buffer/IO/cache stats where available, predicates and filter/index conditions, index name and type where available, and logical join type where applicable. The full per-field, per-engine mapping — including which fields each engine simply doesn't expose, and how the panel should honestly state that — is specified in `docs/10-node-stats-field-catalog.md`; this section's implementation must follow that catalog exactly rather than improvising field names or filling gaps with guesses. Any cumulated parallel-worker or multi-thread timing (see the field catalog's precision note — this is primarily a worker/thread-summation concern, most pronounced on SQL Server's per-thread `ActualElapsedms`, not a Postgres loop-averaging concern) is shown as **two explicit rows**, never one ambiguous number: "Total (cumulated across N workers/threads): Xms" and "Per-execution (approx): Yms."
4. **Why this might matter here**: the specific `Warning[]` that fired for *this* node, reusing `Warning.shortText`/`longText` from the rule engine (Beginner/Expert toggle applies here, same as the walkthrough mode). This section is empty/absent when no warning fired for the node — not padded with generic content to avoid looking empty.
5. **In general**: the glossary's "when this is typically fine" / "when this is typically worth a second look" content — kept visually and structurally distinct from section 4, since one is general education and the other is a specific finding about this plan. Conflating them is exactly the kind of false-confidence problem the parameter-sensitivity honesty note (Episode 5) already guards against elsewhere.
6. **Contribution to the plan**: this node's cost/time as a percentage of the total plan — a number no competitor tool surfaces clearly, and a fast answer to "how much does fixing this actually matter."
7. **Query correlation**: highlights the corresponding clause in the original query text when available (see `graph-visualization` skill — additive, not required). When unavailable (no query text captured, or Snowflake redaction), the panel states plainly *why* it's unavailable rather than just omitting the section silently.
8. **Raw attributes**: the untouched `attributes` bag, collapsed by default, Expert-mode-visible — the escape hatch for anyone who wants to see exactly what the engine reported with nothing normalized away.

**Acceptance criteria**
- Every normalized `operatorType` has a glossary entry; any `operatorType` resolving to `unknown` (see `plan-normalization` skill) shows the raw label plus a plain "we don't have a detailed explanation for this operator yet" state — never blank, broken, or silently missing the section.
- Sections 4 and 5 are visually distinct enough that a usability read-through confirms testers don't confuse "general fact about this operator type" with "something specific is wrong with my plan."
- Contribution-to-plan percentage never renders as `NaN%` or a nonsensical value on trivial/degenerate plans (single-node plans show 100% by definition; zero-total-cost plans show a graceful fallback, not a divide-by-zero artifact).
- Cumulated vs. per-execution time distinction renders correctly against the parallel-worker and multi-loop fixtures already in the library from Episodes 1–3.

**Testing approach**
- Snapshot/unit tests: for a representative fixture per engine, assert the panel renders all eight sections with the expected content for at least one node with warnings and one node without.
- Glossary coverage test: every `operatorType` value appearing anywhere in the fixture library resolves to a real glossary entry or the explicit fallback state — run as a suite-wide check, same pattern as the normalization-layer's "seen but unmapped" tracking (a glossary gap and a normalization gap are different kinds of gaps, but both should be tracked from the same "operator seen without full support" signal).
- Manual usability pass: have a non-DBA read sections 4 and 5 on the same node and confirm they can articulate the difference between them in their own words.
- Accessibility test: panel opens via `Enter`/`Space` on a focused node (per the keyboard-navigation requirement), each section has a proper heading level for screen readers, and the panel doesn't trap focus.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `operatorType: "unknown"` (unmapped operator) | No glossary entry exists yet | Graceful fallback state, never a blank/broken panel; logged to the same "seen but unmapped" tracking used by the normalization layer |
| Node with zero fired warnings | Section 4 would otherwise look broken/empty | Section 4 omitted entirely for that node, not padded with filler text |
| Trivial single-node plan | Contribution-to-plan percentage is degenerate (100% by definition, or undefined if total cost is 0) | Explicit handling, never `NaN%` |
| Node from an estimate-only plan (no `ANALYZE`) | No actual time/rows to show | Stats table explicitly states "no actual run data available for this node" rather than showing blank or zero values that look like real data |
| `BitmapAnd`/`BitmapOr` nodes with `actual rows = 0` | Known benign Postgres quirk (see `postgres-plan-parsing` skill) | Glossary/stats section proactively explains this is expected behavior for this operator type, so it doesn't read as missing data |
| Redacted Snowflake query text | Section 7 (query correlation) has nothing to correlate against | State the reason plainly ("query text redacted by account policy") rather than silently omitting the section |
| Rapid clicking across many nodes in a large plan | Panel re-render performance | Panel content should be cheap to swap (derive from already-computed `PlanNode`/`Warning[]` data, no re-computation of layout or re-fetch of glossary content per click) |

### Story 6.3 — Canvas-first layout: collapse chrome to on-demand overlays

Source: user-directed layout restructure, following manual testing that found the node-graph — the actual point of this product — was consistently the smallest region on screen. **This does not exist anywhere else in the docs** — it was authored directly from the user's own detailed requirements message rather than being pre-existing, unlike every other story in this file; confirmed via a direct search before writing it. It's placed here (Episode 6, immediately after 6.1/6.2) because it's fundamentally about the graph's own screen real estate, though it restructures the shell Episode 18 Story 18.2 built and depends on several other already-shipped stories — see "Depends on" below.

**Depends on** (their actual shipped state, checked in-repo before writing this story, not assumed from episode order):
- **Story 18.2 — App shell layout**: shipped. The three-column grid (left rail | canvas | right rail), the 1180/860/620 `@container` breakpoints, and `DetailPanel`'s existing `variant="shell"` (grid track ≥1180px, scrim-overlay <1180px) vs. `variant="overlay"` (always `position: fixed`, every other caller) are the foundation this story builds on — it does not rebuild them, it changes which variant the shell uses **by default**.
- **Story 13.1 — Complete findings list**: shipped (`FindingsList.tsx`, `collectAllFindings`/`collectFindingsAcrossStatements`). Its filtering/data logic is reused as-is; only its row markup gains a compact rendering mode.
- **Story 23.3 — Query Health card**: shipped, and **already does most of what this story's item 4 asks for** — collapsed-by-default score + severity legend, a "Show breakdown" toggle gating the per-dimension list. The one real gap found by reading the actual component (not assumed from the user's description of "current pain," which pre-dated this card and doesn't match its actual shipped behavior): each insufficient-data dimension inside the *expanded* breakdown still gets its own `<li>` row — this story's only Query Health change is consolidating those into one combined line.
- **Story 15.1/15.2 — Canvas-based rendering for large plans**: shipped, unaffected by this story — the DOM/SVG-vs-canvas switch and its 300-node threshold are internal to `PlanGraph`'s canvas area, which this story resizes but does not otherwise touch.
- **Episode 22 (maximized mode)**: shipped, explicitly **out of scope** for this story. Maximized mode already solves "the graph gets the whole viewport" its own way (a `position: fixed; inset: 0` overlay with its own toolbar/Findings drawer/detail popup); this story only restructures the **normal, non-maximized** shell. `isMaximizedFindingsOpen` and its own `<FindingsList>` render are untouched.

As a user analyzing a plan, I want the node-graph to be the dominant thing on screen by default — with plan input, recent plans, findings, and node detail all one click away rather than permanently reserving layout space — so I can actually see and navigate the plan I came here to read, on a laptop-sized screen as much as a large monitor.

**Acceptance criteria**

1. **Detail panel becomes overlay-by-default at every shell width**, not just <1180px. `PlanReaderPage.tsx`'s right rail switches its `DetailPanel` from the `variant="shell"` it uses today to `variant="overlay"` (a mode that already exists — `position: fixed`, never a grid track, at every existing caller) by default; `.plan-shell__body`'s `grid-template-columns` drops its 3rd (right) track when not pinned, so the canvas column absorbs that space rather than it sitting reserved and empty. A visible pin control ("Keep panel open") on the panel itself flips a page-level `isDetailPinned` boolean (session-only state, not persisted across reloads — a deliberate, disclosed scope limit, same shape as the existing `dontSave` toggle) that restores the exact pre-existing `variant="shell"` behavior (grid track ≥1180px shell width, scrim-overlay below it) for as long as it's on, surviving deselecting/reselecting nodes. The scrim (`.plan-shell__detail-scrim`) now renders whenever an un-pinned panel is open, at every width, not gated to <1180px — clicking it, or the panel's own × control, closes the panel and the canvas reclaims the width immediately (no transition delay beyond the panel's own existing close, since removing a `position: fixed` element never affects layout to begin with).
2. **Plan input + Recent plans collapse into a narrow icon rail by default**, once a plan has been analyzed. New `IconRail.tsx` component: three icon buttons — New plan, Recent plans, Findings — each opening the SAME content that used to sit permanently in the left rail, in a scrim-backed overlay anchored next to the rail (matching the detail panel's own overlay mechanics — one overlay pattern in this app, not two independently-built ones). "Findings" is the one exception: instead of opening a rail-adjacent overlay, it toggles the bottom findings drawer (item 3) open/closed, and its icon carries a badge (total finding count, colored by the worst severity present). Before any plan is analyzed (`!analyzed`), the icon rail does not apply — the input panel renders inline and prominent, exactly as today, since there is nothing else competing for space and hiding the one thing a first-time visitor needs behind an icon would be a real regression, not a space optimization.
3. **Auto-collapse the New Plan panel when Analyze runs.** `handleAnalyze`'s existing success path additionally closes the New Plan overlay (if open) back to the icon rail — the raw pasted text isn't needed once results are showing (`PasteBox.tsx`'s own existing internal `isCollapsed` state already collapses the textarea itself to a "pasted · N lines" summary on submit; this is that same behavior one level up, for the panel that now contains it). Re-openable via the same icon, to edit and re-analyze.
4. **Findings list becomes a collapsible bottom drawer** spanning the canvas column (not the old permanent left-rail position). Collapsed (default): one compact summary line — `"{total} findings · {critical} critical · {warning} warnings · {info} info"` (this app's own real severity vocabulary — `info`, not a fabricated "healthy" bucket findings don't have; `QueryHealth`'s separate node-scoped "healthy" count is a different concept and isn't reused here). Expanded: `FindingsList` gains a `variant="compact"` prop reusing 100% of its existing filtering/data logic (severity + category selects, `collectFindingsAcrossStatements`) — only the `<li>` row markup changes, from today's padded, bordered, severity-tinted card to a single-line row (severity dot + truncated `shortText` + category, click behavior unchanged). Expanded height is capped (`min(38vh, 420px)`) with its own internal scroll past the cap — it does not grow to push the canvas off-screen, and it visually insets away from an open, un-pinned detail panel (via a class toggle keyed on whether `detailPanel` is set) so the two never clip or hide each other in the bottom-right corner where they'd otherwise coincide.
5. **Query Health's expanded breakdown combines every insufficient-data dimension into one line** ("N metrics unavailable for this plan") instead of one `<li>` per unavailable dimension; scored dimensions are unaffected, each still gets its own row. Omitted entirely when there are zero insufficient dimensions (never "0 metrics unavailable").
6. **App-bar action buttons collapse to icon-only with a tooltip, unconditionally** (not breakpoint-gated the way Export already partially is): "Walk me through it" and "Compare with another plan" gain the same icon+`aria-label`+visually-hidden-label shape Export already uses, plus a native `title` attribute for a hover tooltip, with their text label hidden at every width by default (Compass / ArrowsLeftRight from the already-installed `@phosphor-icons/react` package — confirmed present before use).
7. **Nothing reachable today becomes unreachable.** Every control this story moves (New plan, Recent plans, Findings' filters, the detail panel's full content, Query Health's per-dimension breakdown) is fully present in its new location — repositioned/collapsed, never removed.

**Testing approach**
- Component tests: `IconRail` open/close per icon, badge count on Findings; `FindingsList`'s new `variant="compact"` row markup with the SAME filter behavior as `variant="list"`; `QueryHealthCard`'s combined-unavailable-line rendering (0/1/N insufficient dimensions); `DetailPanel`'s pin toggle surviving a node deselect/reselect.
- Regression: every existing `PlanReaderPage.test.tsx`/`FindingsList.test.tsx`/`DetailPanel.test.tsx`/`PlanGraph.test.tsx` test re-run, not assumed to still pass — a layout restructure can break a test that queried a fixed DOM position or a permanently-mounted component. `plan-shell.spec.ts`'s two existing e2e tests (1180px grid-track / <1180px overlay) get rewritten: the grid-track assertion moves to the **pinned** path (pin turned on first), and a new default-is-always-overlay test replaces the old default-<1180px-only one.
- e2e (Playwright, real browser — jsdom implements neither `@container` queries nor real layout, same reasoning `plan-shell.spec.ts` itself already documents): the full numbered list at the top of this session's request, reproduced as the edge-case table below with one test named per row.
- Before/after canvas-area-to-viewport measurement: `getBoundingClientRect()` on `[data-testid="plan-shell-canvas"]` vs. the full viewport, captured once against `main` (pre-this-story) and once against this story's own branch, at a fixed representative viewport size — the actual percentages, not just "bigger now," reported in the story's own PR/BACKLOG-STATUS entry.

**Edge cases to handle**
| Case | Why it matters | Handling | Test |
|---|---|---|---|
| Default-state canvas ratio on load, nothing selected, all panels collapsed | This is the story's own accountability bar — not just "panels became collapsible" as an abstract property | Measure `plan-shell-canvas`'s `getBoundingClientRect()` against the viewport at a fixed size, before (main) and after (this branch); canvas share must increase from roughly a third to a large majority | `e2e/canvas-real-estate.spec.ts` — default-ratio test |
| Selecting a node while un-pinned | Must be a true overlay, not a reflow — the failure mode a `flex-basis`/grid-column change would cause | Assert the detail overlay appears AND `plan-shell-canvas`'s own bounding box is byte-for-byte unchanged before/after selection | same file — selection-is-overlay test |
| Closing the overlay (× control) | Canvas must reclaim the width immediately, not after a delay independent of the panel's own close | Assert overlay is gone and canvas's bounding box matches its pre-selection size again | same file — close-restores-canvas test |
| Each icon-rail icon | Must expand its own panel and must NOT reserve layout space while collapsed | Click New plan/Recent plans/Findings in turn; assert the right overlay opens each time; assert `plan-shell__body`'s canvas column width is unaffected by a collapsed rail regardless of which (if any) icon panel is currently open | `e2e/icon-rail.spec.ts` |
| Pasting text and clicking Analyze | The raw pasted text isn't needed once results show, but must stay reachable | Assert the New Plan overlay auto-closes to the rail right after a successful analyze; assert clicking the New Plan icon again reopens it with the same text still present for editing | `e2e/icon-rail.spec.ts` — auto-collapse test |
| Findings drawer at real-world counts (dozens of findings) | The old full-card layout doesn't stay usable at scale — this story's whole reason for existing | Assert collapsed state renders exactly the one-line summary text (not the full list); assert expanded state renders one compact row per finding, not a padded card; assert the expanded container's height never exceeds its cap, with the item list itself scrolling past it | `e2e/findings-drawer.spec.ts` |
| Health panel with several unavailable metrics (e.g. a Snowflake plan, or Postgres without `BUFFERS`) | Each metric consuming its own permanently-visible "not enough data" row is exactly the clutter this story removes | Assert the collapsed default is the one-line score+legend (unchanged from Story 23.3); assert "Show breakdown" reveals scored dimensions individually AND one combined "N metrics unavailable" line, never N separate empty-looking rows | `e2e/query-health-breakdown.spec.ts` |
| Detail overlay open AND findings drawer expanded at the same time | Two independent overlays with no coordination between them could visually collide in the bottom-right corner | Assert both remain fully visible and independently clickable; assert neither's content is clipped or hidden behind the other, and the canvas between them is still visible | `e2e/combined-open-state.spec.ts` |
| "Keep panel open" pinned | A user comparing node data continuously needs the panel to survive deselecting a node, unlike the default overlay-on-select behavior | Assert turning the pin on keeps the panel visible (grid-track, ≥1180px) after closing/deselecting, distinct from the default's disappear-on-close | `e2e/detail-panel-pin.spec.ts` |
| Mobile viewport (repeats: overlay/close, icon rail, findings drawer) | A shrunk desktop layout is not automatically a usable mobile one — this app's own existing mobile commitments (Episode 18 Stories 18.12/16.2) apply here too | Re-run the equivalent of the selection-overlay, icon-rail, and findings-drawer tests at the existing `mobile-viewport.spec.ts` breakpoint (390×844); confirm each pattern has a sensible touch/mobile shape (e.g. the detail overlay may reasonably become the existing bottom-sheet treatment already built for narrow viewports) rather than a shrunk, harder-to-tap desktop control | `e2e/mobile-viewport.spec.ts` — new cases alongside the existing ones, not a separate file (keeps one home for "is this app usable on a phone") |
| Rapid toggling (several open/close actions in quick succession) | Fixed-position overlays mounting/unmounting quickly is a real, known source of animation-interrupted state corruption | Click through several panel open/close actions back-to-back; assert the FINAL DOM state matches the last action taken, not a stale intermediate frame | `e2e/rapid-toggle.spec.ts` |
| Full regression pass | This story restructures WHERE things live, not WHAT they do — content-level tests must survive untouched | Re-run every existing detail-panel-content, graph-rendering, and findings-list-content e2e/component test; confirm all still pass inside the new layout | existing suites, re-run as part of this story's own CI/test pass, not a new file |

---

## Episode 7 — Privacy & client-side architecture

**Goal**: Guarantee the rule-based path never sends plan content to a server, and make that guarantee both technically true and visibly stated.

### Story 7.1 — Fully client-side rule-based path
As a privacy-conscious engineer, I want certainty that my pasted plan (which may contain real schema/data) never leaves my browser in the default mode.

**Acceptance criteria**
- Network request monitoring (in automated tests) confirms zero outbound requests containing plan content during the default rule-based flow.
- Privacy statement is visible directly at the paste box, not only in a footer/docs link (see positioning brief — informed by the PEV2 trust case where users distrusted a technically-safe default because the messaging/default combination wasn't clear).

**Testing approach**
- Automated test: intercept all network calls during a full rule-based-path user flow (paste → parse → visualize → view warnings) and assert none contain plan text, table/column names, or literal values.
- Manual security review before launch: confirm no analytics/logging accidentally captures paste content (even in error logs/stack traces — a classic leak vector when raw input ends up in a caught exception's message).

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Parse errors that include the raw offending input in their message | Error logging/telemetry could accidentally exfiltrate plan content even in a "privacy-safe" tool | Error messages/telemetry must never include raw pasted content, only structural metadata (e.g. "JSON parse failed at position X") |
| Browser extensions or third-party scripts that could read page content | Outside PlanReader's direct control, but worth documenting as a known limitation | State clearly in privacy copy that the guarantee covers PlanReader's own code, and note the caveat about the browser environment generally |
| LLM narrative mode accidentally becoming the default (config/deploy mistake) | Would silently break the core privacy promise | Explicit opt-in state must be tested as a hard default in CI (fails the build if the default flips) |

---

## Episode 8 — Landing page & positioning

**Goal**: Ship the hero copy, meta tags, and structured data from the positioning brief, and validate disambiguation actually works.

### Story 8.1 — Above-the-fold disambiguation
As a first-time visitor from a Snowflake-specific search, I want to confirm within seconds that this tool is relevant to me.

**Acceptance criteria**
- Hero headline, subheadline, and engine logos/names all visible without scrolling on both desktop and mobile viewports.
- `<h1>` contains "execution plan," not just the brand name.
- Meta title/description and schema.org `SoftwareApplication` markup match the positioning brief exactly.

**Testing approach**
- Manual review against the positioning brief checklist.
- Structured data validated with Google's Rich Results Test (or equivalent) before launch.
- Informal "five-second test" with people unfamiliar with the tool: show the landing page for five seconds, ask what they think it does — confirms disambiguation actually works, not just that the copy exists.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Slow-loading fonts/assets delaying the hero text's visibility | Undermines the "unmistakable within seconds" goal | Hero text must not be hidden behind a loading state; prioritize its render path |
| Very narrow mobile viewports cutting off the subheadline or engine logos | Positioning brief explicitly requires mobile visibility | Test at common small-viewport breakpoints, not just one mobile size |

---

## Episode 9 — Funnel touchpoints (pgsuite / QueryDoc)

**Goal**: Contextual, non-pushy callouts tied to specific findings, per the content/launch plan's funnel design.

### Story 9.1 — Contextual, dismissible product callouts
As a Postgres user who's outgrown the free tool, I want a clear, low-pressure next step toward pgsuite.

**Acceptance criteria**
- Callouts are tied to specific warning types (e.g. bloat/vacuum-related finding → pgsuite mention), not shown generically to every visitor.
- Fully dismissible; core tool functionality (explanation + visualization) remains 100% usable with all callouts dismissed or blocked.
- Snowflake-specific findings link to QueryDoc, Postgres-specific findings link to pgsuite — never cross-wired.

**Testing approach**
- Unit tests: verify the correct callout (or none) renders for each warning-type fixture.
- Manual UX review: confirm dismissal persists for the session and doesn't reappear intrusively.
- A/B-style qualitative check post-launch (per PRD success metrics) on callout click-through, without ever logging which specific plan triggered a click (aggregate only, consistent with the privacy architecture).

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan triggers both Postgres and non-Postgres-relevant warnings in edge cases (shouldn't happen given engine-scoping, but worth guarding) | Wrong-product callout would be confusing and undermine trust | Callout logic keyed strictly to the detected engine, tested explicitly against cross-engine mixups |
| Ad blockers or privacy extensions hiding callout UI entirely | Common in this exact audience (privacy-conscious developers) | Core tool must degrade gracefully with zero functional loss if callout UI never renders |

---

## Episode 10 — LLM narrative mode (Should-have, fast-follow)

**Goal**: Opt-in hybrid narrative layer sending only structured findings (not raw plan text) to the Claude API.

### Story 10.1 — Opt-in narrative generation from structured findings
As a user who wants a more connected, readable explanation than the bullet-point rule warnings, I want an optional AI-narrated summary.

**Acceptance criteria**
- Explicit, separately-labeled opt-in click required — never pre-checked or silently triggered.
- Only structured findings (operator types, severities, relative costs) sent by default; raw literal query text/table/column names are not included unless a further explicit opt-in is added later (Phase 2+, per tech spec).
- Narrative is additive to, not a replacement for, the rule-based warnings (which remain visible even if the LLM call fails or is skipped).

**Testing approach**
- Contract tests on the payload sent to the API: assert it contains only the structured-findings shape, never raw plan text, for every fixture.
- Failure-mode testing: API timeout/error must not break the rest of the page — rule-based output must render independently and fully regardless of LLM call outcome.
- Cost/latency monitoring in a staging environment before enabling for real traffic, given the "free public tool with unpredictable volume" risk flagged in the tech spec.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| LLM call fails, times out, or rate-limits | Must never block or break the core rule-based experience | Fully independent rendering path; narrative section shows a simple retry/unavailable state |
| Zero warnings fired (nothing for the LLM to narrate) | Empty input to phrase | Skip the LLM call entirely, reuse the "looks fine" summary from Story 5.2 |
| A user rapidly clicks the opt-in repeatedly (double-submit) | Cost control | Debounce/disable the button during an in-flight request |

---

## Episode 11 — Sharing / publish (Should-have, fast-follow)

**Goal**: Opt-in, per-plan publishing for sharing a parsed plan via link, modeled on pgMustard's explicit-warning pattern.

### Story 11.1 — Explicit opt-in plan publishing
As a team lead, I want to share a specific parsed plan via a link, with a clear warning about what that means.

**Acceptance criteria**
- Publishing is off by default and per-plan (never a blanket "always publish" setting).
- A warning to check for sensitive data appears at the point of publishing, not just in documentation, mirroring pgMustard's explicit per-publish warning.
- Published links are unguessable (sufficiently random IDs), and there's a way to un-publish/delete.

**Testing approach**
- Manual security review: confirm published plan IDs aren't sequential or guessable.
- Unit test: un-publish actually removes server-side access, not just delists it from a UI.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| User publishes, then wants to redact/remove specific sensitive fields after the fact | Real workflow gap seen in competitor tools (no easy post-publish edit) | At minimum, support full un-publish; consider partial redaction as a later refinement, not a launch blocker |
| Published plan link shared outside the org (support ticket, public forum) | The nature of a share link | No account required to view a published link is by design (matches pgMustard), but the pre-publish warning must make this consequence explicit |

### Story 11.2 — Client-side-only shareable link (no backend)

**Goal**: A share option that requires zero server infrastructure — the entire plan state is encoded into the URL itself, so "sharing" is just sending a link, and "viewing" is the recipient's own browser decoding and re-parsing it locally. This is a genuine alternative to Story 11.1, not a lesser version of it — it keeps the fully-client-side privacy guarantee (Episode 7) intact even for the sharing feature, which Story 11.1's server-published-link approach cannot claim by design. Evaluate both; they can coexist (11.2 as the default, 11.1 as a fallback for plans too large to fit in a URL).

As a user who wants to share a plan without trusting any server with it — including PlanReader's own — I want a link that encodes the whole plan in the URL, so nothing is ever stored anywhere.

**How it works**
- Compress the parsed `PlanNode` tree (or the raw plan text, if re-parsing on load is preferred over shipping already-parsed state) using a client-side compression library (e.g. `lz-string` or `pako`), then base64/URL-safe-encode the result into a URL fragment (`#`) rather than a query parameter — fragments are never sent to a server in an HTTP request at all, which is a meaningfully stronger privacy property than a query string (query strings can end up in server access logs even for a static host).
- On load, if a fragment is present, decode/decompress it client-side and render immediately — no network round-trip, no server ever sees the content, consistent with the Episode 7 privacy architecture.
- The link itself can be arbitrarily long but browsers and some sharing surfaces (chat apps, SMS) have practical URL-length limits (commonly reliable up to roughly 2000 characters across widely-used tools, even though modern browsers individually support much more) — this is the core constraint of the whole approach and must be handled honestly, not silently.

**Acceptance criteria**
- A "copy shareable link" action produces a URL that, when opened in a fresh browser with no prior state, renders the identical plan visualization and warnings.
- The mechanism uses the URL fragment, not a query parameter, and a test confirms the fragment content never appears in any network request (consistent with the Episode 7 network-call-guarding test).
- When the compressed, encoded plan would exceed a defined safe length threshold, the UI states this plainly ("this plan is too large for a link-only share") rather than silently producing a broken or truncated link, and — if Story 11.1 is also implemented — offers the backend-based publish option as an explicit, clearly-different alternative at that point.
- Works with no account, no signup, consistent with the rest of the product.

**Testing approach**
- Round-trip test: encode a plan, decode it, assert the resulting `PlanNode` tree is identical to the original.
- Size-threshold test: a deliberately oversized fixture (from the large-plan edge cases in Episodes 1–3) triggers the "too large" state rather than producing a broken link.
- Network-call-guarding test (extends the Episode 7 test): confirm loading a fragment-encoded shared link produces zero outbound requests containing plan content.
- Cross-browser test: the specific compression/encoding approach chosen should be verified against real sharing surfaces' URL-length tolerances, not just a browser's theoretical maximum.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Plan too large to encode within a safe URL length | Common for large real-world plans (100+ nodes), not a rare case | Explicit "too large for a link-only share" message; offer Story 11.1's backend option as a distinct alternative if available, rather than failing silently or producing an unusable link |
| Recipient's browser/sharing app truncates or mangles the URL (common in chat apps that auto-linkify) | Breaks the decode step | Detect malformed/truncated fragment data on load and show a clear "this link looks incomplete" message, not a blank page or a raw decode error |
| Compression library differences across browser versions | Could produce decode failures on old browsers | Use a well-established, broadly-compatible library; test against the oldest supported browser target, not just the latest |
| A link encodes a plan that predates a `PlanNode` schema change (future-proofing) | The app's data model will evolve over time | Version the encoded payload (a short version tag in the encoded data) so a future decoder can detect and handle old-format links gracefully rather than crashing on them |

---

## Episode 12 — Launch readiness & content tie-in

**Goal**: Cross-link existing @scalingbackend content bidirectionally and validate the tool against real-world plans before wide release.

### Story 12.1 — Concept-to-content linking map
As a user who wants to learn more about a specific warning, I want a link to the relevant part of Kiran's existing video series or blog post.

**Acceptance criteria**
- Every Must-have rule warning (Episode 5) that has a corresponding concept in the existing content links to it; gaps are tracked as a known list, not silently absent.
- Links open in a way that doesn't lose the user's current plan/session state (new tab, not full navigation away).

**Testing approach**
- Manual audit matching each rule to existing content, cross-checked against the gap list called out in the content/launch plan.
- Link-rot check (automated) as part of CI, since these are external links into existing site content that could change.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A rule warning has no existing content to link to | Content/launch plan explicitly expects some gaps | Link is simply omitted for that warning rather than pointing to an irrelevant page; gap logged as future content backlog |

### Story 12.2 — Soft-launch validation against real plans
As the product owner, I want to validate parser/rule robustness against real-world pasted plans before the wider community launch.

**Acceptance criteria**
- Soft-launch period (linked only from existing blog/video content per the launch plan's sequencing) runs long enough to surface parsing edge cases from real, non-fixture input.
- Any new parse failure or misfire discovered is triaged, fixed, and added back into the fixture/unit-test library (closing the loop so it can never silently regress).

**Testing approach**
- Aggregate-only error monitoring: track parse-failure *rates* and *categories* (e.g. "SQL Server XML root-detection failures") without ever logging the raw content that failed, consistent with the privacy architecture in Episode 7.
- Go/no-go checklist before the wider Hacker News / Reddit community launch: parse-failure rate below an agreed threshold, no open privacy-architecture bugs, mobile rendering verified.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A real-world plan format variant not covered by any fixture (e.g. an unusual Postgres extension's custom `EXPLAIN` output) | Fixtures can't cover everything in advance | Graceful "couldn't fully parse this, here's what we could extract" partial-result mode is preferable to an all-or-nothing failure |
| Traffic spike from an unexpectedly viral community post | Free, no-signup, high-visibility launch could produce a burst | Confirm the client-side architecture (Episode 7) means this is a non-issue for the core path; only the optional LLM/publish endpoints need rate-limit consideration |

---

## Episode 13 — Complete recommendations coverage

**Goal**: Manual testing surfaced that the current recommendations output isn't comprehensive — Story 5.2's top-level summary was deliberately designed to synthesize only the highest-severity 1–3 findings into a paragraph, but that design choice left no place in the product where a user can see *every* finding the rule engine actually detected. This episode fixes that gap without breaking the reason the short summary exists in the first place (a beginner shouldn't be confronted with a wall of text on first load).

### Story 13.1 — Complete findings list, separate from the synthesized summary

As a user who wants to know everything the tool found, not just the headline issues, I want a complete, unfiltered list of every warning detected across the whole plan, so I can decide for myself what to prioritize instead of trusting the tool's top-3 synthesis alone.

**Acceptance criteria**
- A dedicated "All findings" view lists every `Warning` produced by the rule engine (Episode 5) across every node in the plan — no count cap, no truncation.
- Each entry links to (or, on click, navigates the graph to and opens the detail panel for) the specific node it came from — a finding divorced from its node is much less useful.
- Sortable/filterable by severity and by engine-relevant category (e.g. "scan issues," "join issues," "spill") — with a large plan producing many findings, an unsorted flat list is barely better than the cap it replaces.
- The short synthesized summary (Story 5.2) is retained as-is and clearly positioned as "the highlights" with an explicit link/button into the complete list — not replaced by it. Two different jobs: orientation for a beginner, completeness for anyone who wants it.
- Zero-findings state reuses the existing "looks fine" messaging (Story 5.2), applied consistently to this view too.

**Testing approach**
- Unit test: for a fixture with N warnings across multiple nodes, the complete list renders exactly N entries — no silent cap reintroduced by a default page size or similar.
- Snapshot test confirming the short summary and the complete list can disagree in emphasis (summary highlights 2 critical issues; complete list shows those 2 plus 15 info-level ones) without contradicting each other.
- Manual UX check: a user reading only the short summary and a user reading the complete list should reach compatible conclusions about what matters most — the complete list's sort order (severity-first) should make this natural, not require the user to manually triage 15 items.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan with a very large number of findings (a genuinely bad large plan could produce dozens) | Naive rendering of dozens of list items could itself become a performance issue, ironically | Virtualized list rendering for the findings list itself, same principle as the graph's node virtualization (Episode 6/15) |
| Same underlying issue firing on many structurally similar nodes (e.g. 12 identical seq-scan warnings across 12 partition children) | A flat list of 12 near-identical entries is noisy, not more informative | Consider grouping/collapsing near-identical findings by rule + operator type with a count ("12 partitions scanned sequentially"), expandable to the individual nodes — evaluate during implementation; don't let grouping become a second, undocumented cap |
| Filter/sort state should not reset when the user clicks into a finding's node and back | Basic usability | Preserve view state across navigation within the session |

**Correction to Story 5.1's edge-case table**: the earlier note "cap the number shown by default with an option to expand" (for multiple warnings *on a single node*, in the detail panel) still stands — that's a different, legitimate concern (one node's detail panel shouldn't be a wall of text) from this episode's fix, which is about the *plan-wide* findings view never being capped. Keep both: per-node detail panel stays reasonably concise, the new complete-findings view is exhaustive by design.

---

## Episode 14 — Execution plan comparison

**Goal**: Let a user compare two plans (most commonly: before/after an index change, or two candidate plans for the same query) and see what actually changed — structurally, in cost, and in timing — without manually cross-referencing two separate visualizations. SQL Server's own SSMS has a mature version of this feature worth learning from directly: it matches operators between the two plans, highlights unmatched ones distinctly, and synchronizes selection so clicking a node in one plan selects its counterpart in the other. That's the right shape to build toward, made cross-engine.

### Story 14.1 — Node matching algorithm

As the foundation for any comparison UI, I need a reliable way to match nodes between two plans of the same query (or two versions of a similar query), so the comparison view can say "this node in Plan A corresponds to this node in Plan B" rather than just showing two unrelated trees side by side.

**Acceptance criteria**
- A matching function `matchNodes(planA: PlanNode, planB: PlanNode): NodeMatch[]` returns, for every node in both trees, one of: `matched` (a confident correspondence, with both node IDs), `changed` (matched, but with a materially different operator — e.g. a seq scan became an index scan on the same table), `addedInB` (no correspondence in A), `removedFromB` (present in A, absent in B).
- Matching uses a layered strategy, falling back progressively: (1) exact signature match — operator type + relation/index name + structural position (depth, ordinal position among siblings) all agree; (2) relaxed match — same relation/index touched and similar structural position, different operator type (this is the "changed" case, e.g. an index was added and the scan type changed); (3) positional-only fallback for nodes with no relation/index identity (e.g. a `Sort` or `Aggregate` with nothing to match on) — same depth and ordinal position; (4) unmatched — no reasonable correspondence found, reported as added/removed.
- Matching is engine-consistent: both plans in a comparison must be from the same engine (comparing a Postgres plan to a SQL Server plan for "the same query" isn't structurally meaningful given how differently the engines represent operators) — the UI should detect and reject a cross-engine comparison attempt with a clear explanation, not attempt to force a match.

**Testing approach**
- Unit tests against pairs of fixtures representing real before/after scenarios: an index added (a scan node's operator type changes, matched via relation-name continuity), a join order changed (structural position shifts but relation identity persists), a table added/removed from the query entirely (genuinely unmatched nodes on one side), identical plans (100% matched, zero changed/added/removed).
- Regression test: matching the same plan against itself always produces 100% `matched` with zero `changed`/`added`/`removed` — a basic sanity floor any change to the matching logic must preserve.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Two plans for genuinely different queries (user error) | Matching could still produce plausible-looking but meaningless results | If the match rate falls below a sensible threshold (e.g. under some percentage of nodes matched), surface a warning that these may not be comparable plans, rather than presenting a low-confidence diff as if it were reliable |
| Cross-engine comparison attempt | Structurally not meaningful (see above) | Detect via each `PlanNode`'s `engine` field, block with a clear message before attempting to match |
| A CTE/subplan referenced differently between the two plans (present in one, inlined in the other) | Normalization already handles shared references within one plan (Episodes 1–4) — comparison adds a second layer of complexity on top | Treat CTE/subplan structural differences as legitimate `addedInB`/`removedFromB` cases rather than trying to force a match across a genuine structural change |
| Very large plans on both sides (100+ nodes each) | Matching is at minimum O(n·m) in the naive case | Use the relation/index identity as a hash-based first pass before falling back to positional comparison, to avoid a naive quadratic scan on large plans |

### Story 14.2 — Comparison view

As a user who just added an index, I want to see my before and after plans side by side with the differences highlighted, so I can confirm the change did what I expected without manually re-reading both plans.

**Acceptance criteria**
- Two plans render side by side (or stacked, toggleable — mirroring SSMS's own toggle between orientations), using the same node-graph rendering as the single-plan view (Episode 6, extended per Episode 15 for large-plan performance).
- Matched-and-unchanged nodes render with a neutral/muted treatment; `changed` nodes are highlighted with the specific delta shown (e.g. "Seq Scan → Index Scan," cost/time delta); `addedInB`/`removedFromB` nodes are highlighted distinctly from `changed` ones — three visually different states, not one generic "different" highlight.
- Clicking a node in one plan selects and scrolls to its matched counterpart in the other plan (when a match exists) — synchronized selection, matching SSMS's behavior.
- A summary strip states the headline delta in plain language (e.g. "3 nodes changed, 1 added, 0 removed — total estimated cost decreased by 40%") before the user has to read the graph in detail.
- Works entirely client-side, consistent with the privacy architecture (Episode 7) — both plans being compared are pasted by the user, never fetched from a server.

**Testing approach**
- Visual regression tests across the fixture pairs from Story 14.1.
- Interaction test: selecting a node in Plan A correctly selects its match in Plan B, and correctly shows "no match" state when clicking an `addedInB`/`removedFromB` node.
- Manual usability pass: a user should be able to answer "did my index change help?" from the summary strip alone, without reading the full graph, for the common before/after-index scenario.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| One or both plans are very large | Two large graphs rendered simultaneously compounds the performance concern from Episode 15 | The canvas-rendering threshold and strategy from Episode 15 apply per-pane independently — a comparison of two 300-node plans should trigger canvas rendering on both sides, not just the single-plan view |
| Plans from different engines pasted by mistake | Story 14.1 blocks the match, but the UI needs to communicate this clearly at the comparison step, not just fail silently | Clear, specific message ("these plans are from different database engines and can't be directly compared") rather than a blank or broken comparison view |
| A node matched with low confidence (positional-only fallback) | Presenting a weak match with the same visual confidence as a strong one is misleading | Visually distinguish confidence tiers if feasible (e.g. a lighter connector line for positional-only matches) — at minimum, don't let a shaky match look as authoritative as a signature match |

---

## Episode 15 — Canvas-based rendering for large plans

**Goal**: Manual testing confirmed real responsiveness problems, and switching the graph to canvas-based rendering is the specific fix requested — this is grounded in a real, well-documented trade-off: DOM/SVG-based rendering (React Flow's approach, one DOM element per node) degrades under load because every node is a tracked, styleable DOM object, while canvas draws directly to a pixel surface with near-constant performance regardless of node count — at the cost of losing built-in interactivity and accessibility, which then have to be rebuilt deliberately. This episode is a genuine architecture revision to Episode 6/Technical Spec §3, not an addition on top of it — see the updated `docs/04-technical-spec-v1.md` §3 and the new `canvas-rendering-performance` skill for the full technical design.

### Story 15.1 — Hybrid rendering strategy: DOM/SVG below a threshold, canvas above it

As a user opening a large plan (100+ nodes), I want the graph to stay smooth and responsive, so I'm not fighting a laggy interface while trying to diagnose a slow query.

**Acceptance criteria**
- Plans below a defined node-count threshold continue to render via the existing React Flow (DOM/SVG) path from Episode 6 — full native interactivity, no regression for the common case, which is most plans.
- Plans above the threshold render via a canvas-based path: dagre still computes layout (unchanged — layout and rendering are separate concerns), but nodes/edges are drawn directly onto a `<canvas>` element rather than as DOM nodes.
- The threshold is a tunable constant, not hardcoded inline, and is informed by real benchmarking during implementation rather than picked arbitrarily — see testing approach.
- Pan/zoom on the canvas path redraws only on transform change (not continuously), using `requestAnimationFrame` and a dirty-flag pattern, and accounts for `devicePixelRatio` so text and lines stay crisp on high-DPI displays.
- Click/hover interactivity on the canvas path is implemented via manual hit-testing against each node's stored bounding box (from dagre's layout output) — no library-provided DOM event handling exists on canvas, this has to be built explicitly.

**Testing approach**
- Performance benchmark suite: render time and interaction responsiveness (pan/zoom/click latency) measured at 50, 100, 250, 500, and 1000+ node plan sizes, for both the DOM/SVG and canvas paths — this is what determines where the threshold should actually sit, not a guess.
- Hit-testing unit tests: given a set of node bounding boxes and a click coordinate, the correct node (or no node, for a click in empty space) is identified.
- Visual regression: canvas-rendered output should be visually consistent with the DOM/SVG path's encoding scheme (node size/color/edge thickness conventions from Episode 6) — a user switching between a small and large plan shouldn't be confused by the visualization suddenly looking different in kind, only in rendering mechanism.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan right at the threshold boundary | Could flicker between modes if the user's action changes node count (e.g. expanding a collapsed subtree pushes it over) | Threshold check happens once per plan load, not continuously recalculated as collapse/expand state changes — mode doesn't switch mid-session |
| Extremely large plans (1000+ nodes, beyond even the documented 500+ risk point) | Even canvas has limits | Combine with virtualization/collapse-by-default (already required in Episode 6) rather than assuming canvas alone solves unbounded scale |
| High-DPI / retina displays | Canvas rendered at CSS pixel resolution looks blurry on high-DPI screens | Scale the canvas backing store by `devicePixelRatio` and scale the drawing context to match — a well-known, necessary step easy to forget |
| Rapid pan/zoom gestures (trackpad flick, pinch-zoom on mobile) | Naive redraw-on-every-event can still jank even on canvas if not throttled | `requestAnimationFrame`-batched redraws, not a redraw per raw input event |
| Browser tab losing focus mid-render | Wasted redraw cycles | Pause the render loop when the tab isn't visible (`document.visibilityState`) |

### Story 15.2 — Accessible fallback for canvas-rendered plans

As a screen-reader or keyboard-only user opening a large plan, I want the same information and navigation the graph provides, so switching to canvas rendering for performance doesn't lock me out of the tool.

**This story is not optional polish — it's required alongside 15.1, not a follow-up.** Canvas content is, by default, invisible to assistive technology: it's a bitmap, not a set of DOM nodes a screen reader can enumerate. Shipping 15.1 without this would directly regress the keyboard-navigation and accessibility work already required in Episode 6 for any plan large enough to trigger canvas mode — precisely the large, complex plans where accessible navigation matters most.

**Acceptance criteria**
- Whenever the canvas rendering path is active, an equivalent accessible list/table view of the same plan (all nodes, their key stats, and a way to open each one's detail panel) is available and reachable via a clearly labeled control — not hidden, not an afterthought link at the bottom of the page.
- Keyboard navigation (Episode 6's arrow-key/search/detail-panel requirements) works identically whether the visual is canvas or DOM/SVG, using the accessible list view as the interaction surface when canvas is active.
- The canvas element itself carries appropriate ARIA attributes (e.g. `role="img"` with a descriptive label, or `aria-hidden` if the accessible list is the true interactive surface) so screen readers don't attempt to read raw canvas pixel data or announce it as an empty/broken region.

**Testing approach**
- Screen reader testing (VoiceOver/NVDA) confirming the accessible list view is discoverable and fully navigable when canvas mode is active.
- Keyboard-only testing (no mouse) confirming every interaction available in DOM/SVG mode (select node, open detail panel, search/filter) has a working equivalent in canvas mode.
- Automated accessibility audit (e.g. axe-core) run specifically against the canvas-mode UI, not just the DOM/SVG mode — these are different enough code paths that passing on one doesn't imply passing on the other.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| User toggles between canvas view and accessible list view mid-session | State (selected node, filter, collapsed subtrees) should persist across the toggle | Shared underlying state, not two independent views that can drift out of sync |
| A screen-reader user on a plan just under the canvas threshold (DOM/SVG mode) | Consistency matters — the accessible list shouldn't be canvas-mode-only if it's actually a better experience generally | Consider making the accessible list view available as an option in DOM/SVG mode too, not exclusively gated behind the canvas threshold |

---

## Episode 16 — UI performance and responsiveness

**Goal**: Manual testing found the page "not responsive enough," specifically calling out the detail panel on open — this is broader than the large-plan canvas work in Episode 15 (which addresses graph rendering specifically) and needs its own investigation, since a laggy detail-panel open on click is a different symptom than a laggy pan/zoom on a large graph.

### Story 16.1 — Diagnose and fix detail panel open latency

As a user clicking any node, I want the detail panel to open immediately, so investigating a plan doesn't feel sluggish at the most frequent interaction in the whole tool.

**Acceptance criteria**
- Detail panel open latency (click to fully rendered panel) is measured and kept under a defined budget (e.g. under 100ms, refined during implementation against real measurement) on both small and large plans.
- No synchronous heavy computation runs on click — glossary lookups, warning retrieval, and contribution-to-plan-cost percentage calculations (Story 6.2) are either pre-computed when the plan is first parsed/normalized, or memoized so repeat opens of the same node are instant.
- Panel open/close uses CSS transitions or lightweight animation, not layout-thrashing techniques (e.g. avoid animating properties that force synchronous reflow — animate `transform`/`opacity`, not `width`/`height`/`top`/`left` directly).

**Testing approach**
- Performance profiling (browser DevTools Performance panel or equivalent automated tooling) specifically on the click-to-panel-open interaction, across a range of plan sizes and node complexity (a node with many attributes and several fired warnings vs. a simple one).
- Regression benchmark: panel-open latency tracked over time in CI (even a rough automated timing assertion) so a future change doesn't silently reintroduce the lag.
- Rapid-click stress test (clicking through many nodes quickly, per Episode 6's existing "cheap to re-render on rapid node switching" requirement) to confirm no cumulative slowdown across a session.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A node with an unusually large raw `attributes` bag (verbose engine output) | Rendering the raw-attributes section (Story 6.2 §8) naively could be the specific slow part | Lazy-render or virtualize the raw-attributes section specifically if it's identified as the bottleneck, rather than optimizing the whole panel uniformly when only one section is slow |
| Detail panel opened while the graph itself is still mid-render (large plan, canvas mode) | Two expensive operations competing for the main thread simultaneously | Panel open should not block on or be blocked by in-progress graph rendering — investigate whether these need to be sequenced or can run independently |

### Story 16.2 — General page responsiveness audit

As any user, I want the page to feel responsive throughout — not just the graph and detail panel — so the tool doesn't feel broken on first impression.

**Acceptance criteria**
- A full responsiveness audit covers: initial page load (landing page, per the positioning brief's "unmistakable within seconds" requirement — slow load undermines that goal directly), paste-to-parse latency, search/filter interaction latency, and general scroll/interaction smoothness.
- Main-thread-blocking work (parsing, normalization, rule evaluation) for large plans is investigated for whether it should move off the main thread (e.g. a Web Worker) so the UI thread stays responsive to input even while a large plan is being processed — this is a genuine architecture question to resolve during implementation, not assumed either way up front.
- Mobile-specific responsiveness is tested separately from desktop, not assumed to follow from desktop performance — touch interaction latency and smaller-device CPU/memory constraints are a different profile.

**Testing approach**
- Lighthouse/Web Vitals style automated auditing (load performance, interaction responsiveness metrics) as part of CI, with thresholds that fail the build on regression.
- Manual testing on a real mid-range mobile device, not only desktop DevTools' mobile emulation — emulation can understate real device constraints.
- If a Web Worker is adopted for parsing/rule evaluation: a specific test confirming the UI remains interactive (e.g. can still open the detail panel of an already-rendered node) while a large plan is being processed in the background.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Very large pasted input (before parsing even starts) | Just handling a multi-MB paste event can itself cause a noticeable stutter | Confirm the paste-handling path itself (not just the subsequent parse) is profiled, not only the parser's own execution time |
| Older/low-end mobile devices | The tool's free, no-signup, broad-reach positioning means it will be used on a wide range of hardware, not just modern desktops | Test against a deliberately modest device/throttled CPU profile, not just the developer's own machine |

---

## Episode 17 — Local browser persistence

**Goal**: Keep the user's pasted plan (and relevant session state) saved in their own browser, so a refresh, an accidental tab close, or coming back later doesn't mean re-pasting from scratch — while staying fully consistent with the Episode 7 privacy architecture, since this data now persists across sessions rather than living only in memory during one visit.

### Story 17.1 — Persist the current plan across page reloads

As a user who accidentally refreshes or closes the tab, I want my pasted plan and current view state restored, so I don't lose my work.

**Acceptance criteria**
- The most recently loaded plan (raw input, or the parsed `PlanNode` tree — whichever is more efficient to persist and restore, evaluated during implementation) is saved to browser storage automatically, debounced rather than on every keystroke.
- On next visit, the tool offers to restore the previous session (not silently auto-loads without asking — a returning user might be pasting something entirely new and shouldn't be surprised by old content reappearing).
- Storage choice (`localStorage` vs. `IndexedDB`) is made based on realistic plan sizes — `localStorage` has a roughly 5–10MB per-origin quota shared across everything stored there, which a handful of large SQL Server XML or verbose Snowflake JSON plans could approach; `IndexedDB` has substantially higher practical limits and is the safer default for this use case.
- This feature stays entirely client-side, consistent with Episode 7 — browser storage is not "sending data to a server," but the detail panel and privacy statement should clarify this distinction if users ask, since "saved" can sound alarming to a privacy-conscious user if unexplained.

**Testing approach**
- Unit test: save then reload correctly restores an identical `PlanNode` tree (or re-parses identically from saved raw input).
- Storage-quota test: confirm graceful behavior (a clear message, not a silent failure or a thrown, unhandled exception) when a save attempt would exceed the browser's storage quota.
- Privacy test (extends Episode 7's guarding): confirm the persistence mechanism itself never transmits stored data anywhere — this is a new code path that touches the same sensitive content the rest of the privacy architecture protects, so it needs its own explicit check, not an assumption that Episode 7's existing test covers it.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Shared/public computer | A saved plan containing real schema/data persisting on a shared machine is a real privacy concern, even though it never left the browser | Provide a clear, easy "clear saved data" control, and consider a "don't save this session" opt-out visible at the point of pasting, not buried in settings |
| Storage quota exceeded | Common with `localStorage` specifically for large plans | Graceful degradation to session-only (no persistence) with a clear message, rather than a broken save or a crashed app |
| Multiple tabs open simultaneously | Concurrent writes to the same storage key from different tabs could clobber each other | Last-write-wins is an acceptable default, but shouldn't corrupt the stored data structure — test concurrent-tab writes specifically |
| Stored data from an older version of the `PlanNode` schema (the app has since evolved) | Same forward-compatibility concern as Story 11.2's link-encoding versioning | Version the persisted payload the same way; a version mismatch on load triggers a clean "couldn't restore your previous session" fallback rather than a crash on malformed/outdated stored data |
| Browser's private/incognito mode | Storage behaves differently (often cleared on close, sometimes quota-restricted) | Detect and handle gracefully — don't assume persistence always works; a private-mode user losing their session on close is expected behavior, not a bug to chase |

### Story 17.2 — Recent plans list

As a user who works with a handful of recurring problem queries, I want to see and reopen a short list of recently viewed plans, so I don't have to keep the raw plan text saved elsewhere myself.

**Acceptance criteria**
- A capped list (e.g. last 10, tunable) of recently viewed plans, each identified by a short auto-generated label (e.g. root operator + timestamp, since there's no query name to rely on) — stored using the same `IndexedDB`-based mechanism as Story 17.1.
- Individually deletable, and a single "clear all" action — consistent with the shared/public-computer concern from Story 17.1.
- Never syncs across devices or browsers (this is explicitly local-only, not a lightweight account system in disguise — consistent with the PRD's non-goal against user accounts).

**Testing approach**
- Unit tests: list caps correctly at the defined limit (oldest entry evicted on overflow), individual and bulk deletion both work correctly.
- Storage-quota interaction test: confirm the recent-plans list and the current-session persistence (Story 17.1) share the storage quota sensibly rather than one silently starving the other.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Two plans that happen to produce the same auto-generated label | Ambiguous list entries | Include enough distinguishing detail (timestamp granularity, node count) in the label to avoid confusing duplicates |
| Recent-plans list itself growing the storage footprint over time | Ten plans' worth of large SQL Server XML could add up | Consider storing a lighter summary (root operator, key stats, warning count) plus the full plan, evaluated against actual storage measurements rather than assumed to be fine |

---

## Episode 18 — UI redesign

**Goal**: A restyle plus five new surfaces, built on `docs/12-ui-redesign-spec.md` (status: confirmed — read it in full before starting any story below; each story here cross-references its section rather than re-explaining it). Dark-only: every `prefers-color-scheme` branch across the codebase's CSS is deleted, not just overridden. No parser, analyzer, or rule-engine change anywhere in this episode — restyle and new client-side UI surfaces only, so the privacy-architecture skill's "no network call in `src/parsers/`, `src/rules/`, `src/graph/`" constraint is unaffected by construction, not something each story needs to re-verify. Building on branch `new-ui`.

**Cross-check against Episode 14 (read before Story 18.14)**: the spec's own §8 ("Parked — plan comparison") describes exactly the comparison feature Episode 14 already shipped (`src/comparison/matchNodes.ts`, `src/graph/comparison/PlanComparisonView.tsx`) — the spec was evidently written without that context. Its "full-screen modal, not a route change" interaction and per-node diff/delta content are **not** a green-field design decision anymore; Episode 14's side-by-side-panes UI already exists and is tested. Story 18.14 scopes to restyling the existing comparison view onto the new shell/tokens, not redesigning its interaction model from the spec's parked notes — see that story for the reasoning.

### Story 18.1 — Design token consolidation

As a developer maintaining this codebase, I want one dark palette instead of four independent per-component token sets, so a future style change happens in one place instead of four.

**Acceptance criteria**
- The `--pr-*` (`src/app/planReaderPage.css`), `--pg-*` (`src/graph/planGraph.css`, `src/graph/canvas/*.css`), `--dp-*` (`src/graph/detailPanel/detailPanel.css`), and `--fl-*` (`src/graph/findings/findingsList.css`) token blocks are replaced by one shared palette per spec §1's table (page/canvas/rail grounds, surface, border, text tiers, accent, critical, warning, funnel-callout teal, radius scale, type).
- Every `@media (prefers-color-scheme: dark)` block in every `.css` file under `src/` is deleted — this product is dark-only now, not "dark-first." A light-mode fallback is not a smaller/safer version of this story; the spec is explicit that the branches themselves go away.
- `:focus-visible { outline: 2px solid #9184d9; outline-offset: 2px }` applies to every interactive element (buttons, node cards, tabs, textarea) with no default browser ring visible anywhere.
- Tinted fills use `color-mix(in srgb, <hue> 14–24%, #232532)`; severity chips are the severity colour at 18% over the surface with a 40–50% border — not flat saturated fills anywhere.
- No layout or component-structure change in this story — pure token/color substitution, per spec §6's own build-order note ("Steps 1–4 are the low-risk restyle block").

**Testing approach**
- A single shared-tokens stylesheet (or CSS custom-property module) is the one place these values are asserted — a grep-style test confirming no `--pr-`/`--pg-`/`--dp-`/`--fl-` token declaration remains outside it, and no `prefers-color-scheme` media query remains anywhere under `src/`.
- Existing component tests (PlanGraph, DetailPanel, FindingsList, PlanReaderPage) must all still pass unmodified — this story changes color values, not DOM structure or test ids, so a passing existing suite is itself the regression check.
- Visual check (manual or the existing `visual-regression.spec.ts` baselines re-captured) that no surface is left rendering the old light palette.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A component reads a token via a fallback value (`var(--pg-card-bg, #ffffff)`, seen in `accessiblePlanList.css`) | The light-mode fallback hardcoded inline would silently survive even after the token itself is renamed/removed | Audit every `var(--x, <fallback>)` usage during this story, not just the `:root`/`.plan-graph` block declarations, and update the fallback to the new dark value too |
| The comparison-view tokens added in Episode 14 (`--pg-comparison-changed/added/removed`, `src/graph/planGraph.css`) | A new, recently-shipped token family that isn't in the spec's own table | Fold these into the consolidated palette using the spec's accent/critical/warning hues rather than inventing new colors, and keep the three states visually distinct from each other per Episode 14's colorblind-safety requirement |
| Any inline `style={{ color: ... }}` in a `.tsx` file bypassing CSS custom properties entirely | Would silently keep rendering the old hardcoded color after the token file changes | Grep every `.tsx` file under `src/graph` and `src/app` for hardcoded hex/hsl literals outside `encoding.ts`'s metric scale (which is deliberately data-driven, not a static token) |

### Story 18.2 — App shell layout

As a user viewing an analyzed plan, I want the three-column layout (input+findings rail, graph canvas, detail panel rail) from spec §2, so the tool reads as one coherent workspace instead of a stacked page.

**Acceptance criteria**
- `PlanReaderPage.tsx`'s result section becomes the `container-type: inline-size` shell described in spec §2, with the exact `grid-template-columns` from the spec (rails flexible, canvas holding a 360px floor).
- Shell height is `100dvh`; only the rails and the detail panel scroll — `min-height: 0` set on every scroll container so the page itself never scrolls independently of them.
- The app bar (52px) matches spec §2's element order and its "Share/Export drop to icon-only before wrapping" rule.
- Left rail stacks Plan input over Findings exactly as spec §2 describes; `FindingsList.tsx`'s two filter selects use `grid-template-columns: repeat(auto-fit, minmax(96px,1fr))`.
- The three breakpoints in spec §2's table (1180 detail-panel-becomes-overlay, 860 input-rail-collapses/tabs, 620 mobile) are implemented as structural changes, not just smaller versions of the same layout — deferred fully to Story 18.12 for the 620 (`1k`) mobile layout itself, but the 1180/860 structural changes belong here since they're shell-level, not mobile-specific.
- The detail panel (`DetailPanel.tsx`) is un-fixed above 1180 — a grid track participating in layout, not a `position: fixed` overlay — and becomes a scrim-backed overlay only below 1180.

**Testing approach**
- Component tests asserting the shell's grid-template-columns and breakpoint class/attribute changes at the three widths (jsdom + a resize/matchMedia mock, or a container-query-aware test approach — note during implementation which the repo's existing test tooling actually supports).
- e2e (Playwright, real browser, real `container-type` support — jsdom does not implement container queries) verifying the detail panel is a grid track above 1180px and an overlay-with-scrim below it, mirroring the existing `mobile-viewport.spec.ts` pattern for viewport-driven assertions.
- Regression: every existing `data-testid` this story's markup changes touch (`plan-graph`, `detail-panel`, findings filters) must still resolve the same way for any test file that isn't specifically about layout.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Comparison view (Episode 14's `PlanComparisonView`, two side-by-side `PlanGraph` panes) rendered inside the new shell | The new shell's column layout wasn't designed with two graph panes in mind | Confirm during implementation whether the comparison view sits inside the three-column shell or replaces it entirely while active — not specified in spec §2, which predates Episode 14's shipped comparison feature (see this episode's goal note) |
| Embedded usage (the shell is deliberately built to `container-type: inline-size` so it "behaves the same embedded or full-page") | A future embed scenario is a real design goal, not speculative — spec §2 says so explicitly | Add at least one test rendering the shell inside a narrower parent container (not just a narrower viewport) confirming the container-query breakpoints respond to container width, not viewport width |
| A very short viewport (laptop with a large OS toolbar, or a browser window resized short rather than narrow) | `100dvh` + internal scroll containers could clip content if the app bar + rail minimums exceed available height | Verify the shell degrades to internal scrolling within the rails/panel rather than clipping the app bar or overflowing the page |

### Story 18.3 — Beginner/Expert mode as page-level state

As a user, I want the Beginner/Expert toggle to live in the app bar and apply everywhere (detail panel, and later the guided walkthrough), so I don't have to re-choose it every time I open a different node.

**Acceptance criteria**
- `expertMode` moves out of `DetailPanel.tsx`'s local `useState` (currently explicitly flagged there as "Local to the panel for now — a future global Beginner/Expert toggle...") up to `PlanReaderPage.tsx` (or an equivalent shared location), passed down as a prop.
- The toggle renders as the app-bar segmented control per spec §2's element order (between the engine badge/spacer and "Walk me through it").
- `DetailPanel.tsx` and every section component that reads `expertMode` today continues to work from the lifted prop with no behavior change to Story 6.2's Beginner/Expert content split (education vs. findings visual separation stays intact).
- Story 18.9's guided walkthrough reads the same lifted state (per spec §5 `1g`: "Beginner mode by default; entering from Expert keeps the toggle") — this story's AC is satisfied once the state is genuinely shared, not duplicated into a second toggle.

**Testing approach**
- Component test: toggling Beginner/Expert in the app bar changes the currently-open detail panel's density without needing to close and reopen it.
- Regression: every existing `DetailPanel.tsx` test that currently drives the toggle via an in-panel control needs updating to drive it via the lifted prop/control instead — audit `src/graph/detailPanel/__tests__/` for this.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| No plan analyzed yet (app bar renders, but there's no detail panel or plan open) | The segmented control has nothing to affect yet | Render it disabled or hidden until a plan is analyzed, rather than a live control with no visible effect |
| Mode persists across selecting a different node | Basic usability — re-picking Beginner every click would be a regression from even the current per-panel state | Confirm the lifted state is genuinely page-scoped, not accidentally reset by `PlanGraph`'s existing "reset state when root changes" logic (`PlanGraph.tsx`'s `prevRoot` check) |

### Story 18.4 — Node encoding, operator icons, and edge rendering

As a user reading a plan graph, I want each node's fill/width/edge-thickness/severity-ring/badges to follow spec §3's exact encoding, and edges to route orthogonally with correctly-sized arrowheads per spec §4, so the graph reads as flow rather than as an aesthetic-only diagram.

**Acceptance criteria**
- `buildGraphElements.ts`'s dagre layout switches to `rankdir: "BT"` (leaves at the bottom); React Flow `Handle` components in `PlanNodeCard.tsx` swap source/target to Top/Bottom accordingly.
- Node fill/width/severity-ring/dashed-mismatch-border/badges match spec §3's table — the severity ring is a new signal (2px amber / 3px red box-shadow + faint glow) additive to, not replacing, the existing "never color alone" mismatch dashed-border encoding (`graph-visualization` skill).
- A new operator-icon module (e.g. `src/graph/operatorIcons.ts`, alongside — not inside — the per-engine `operatorMap.ts` files, since `operatorType` is the shared, normalized vocabulary those files map *into*) provides spec §3's icon table keyed on `operatorType`, with an explicit `unknown`/fallback icon — same "every mapping needs a fallback" rule the `plan-normalization` skill already requires of the operator-type maps themselves.
- Edges use React Flow's `smoothstep` type with `borderRadius: 8`, multiple inputs entering a parent's bottom edge at separate x offsets (one target handle per input index, not one shared point), fixed-11px arrowheads (`markerUnits="userSpaceOnUse"`) regardless of stroke weight, a 10px gap before the parent border, and exactly two stroke colors (hot-path vs. not) per spec §4.
- Node subtitle (relation/index name, mono, ellipsised) is sourced the same way Episode 14's `matchNodes.ts` already had to solve relation/index identity extraction from `PlanNode.attributes` (see that file's `relationIdentity`/`indexIdentity` — `PlanNode` still has no normalized relation field; reuse that same per-engine-key reading, don't re-derive it a third way).

**Testing approach**
- `buildGraphElements.test.ts` extended for the new `rankdir`, edge `type`/`borderRadius`, per-input target-handle-index assignment, and severity-ring/badge data.
- A colorblindness-simulator check on the new severity ring, per the graph-visualization skill's explicit checklist item for any change touching mismatch/severity encoding.
- Visual regression: re-capture `visual-regression.spec.ts`'s existing baselines (small and larger plan graphs) against the new encoding.
- Unit test confirming the operator-icon map has a fallback for `operatorType: "unknown"`, mirroring the `plan-normalization` skill's testing checklist for the operator-type maps themselves.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A node with many parents pointing into it (Snowflake's shared-reference/multi-parent case, already handled distinctly via a dashed edge — see `buildGraphElements.ts`'s module comment) | Spec §4's "separate x offsets per input" rule and the existing shared-reference dashed-edge convention both apply to the same edges | Confirm the two encodings compose (a shared-reference edge still gets its own offset target handle, and keeps its dashed styling) rather than one silently overriding the other |
| A node carrying both a severity ring (new) and the existing loop-count/spill/mismatch badges | Multiple simultaneous visual signals on one small card | Confirm legibility at the card's minimum width (150px per spec §3) with all applicable signals present at once — this is exactly the kind of card the guided walkthrough (Story 18.9) will want to explain, so it can't be visually noisy |
| Canvas-mode rendering (`canvasDraw.ts`) must mirror every DOM/SVG encoding change in this story | The canvas-rendering-performance skill's "visual consistency" checklist item — a user switching between plan sizes shouldn't perceive a different tool | Update `canvasDraw.ts`'s hand-rolled drawing (icons, severity ring, orthogonal edges, arrowheads) in the same story, not a follow-up — same "not optional, not deferred" rule Episode 15 established for the accessible-list fallback |
| Very low zoom (canvas mode's existing legible-zoom-floor degrade to solid heat blocks, spec §5 `1i`) | Icons and subtitles becoming illegible before the block-degrade kicks in | Confirm the new per-node signals (icon, subtitle) degrade at or before the existing legible-zoom floor, not independently of it |

### Story 18.5 — Landing/input redesign: file drop, file picker, sample loaders

As a first-time visitor, I want to drag-drop or pick a plan file, or load a one-click sample per engine, instead of only pasting text, so getting started doesn't require me to already have a plan copied to my clipboard.

**Acceptance criteria**
- Hero copy (headline, subheadline, engine list, placeholder, privacy statement, extensions caveat) renders unchanged, character-for-character, from `positioningCopy.ts` and `privacy/copy.ts` — Story 8.1's exact-match assertion is not relaxed by this restyle.
- A dropzone accepts a file; `FileReader.readAsText` reads it and hands the resulting string to the existing `analyzePlanText()` — no new parse path, no upload, no `fetch`/`XMLHttpRequest` anywhere in this flow.
- A file picker (`<input type="file">`) is offered alongside the dropzone as a non-drag-dependent alternative.
- Sample-plan buttons, one per engine, load real fixtures from `src/fixtures/` chosen specifically because each fires a different rule (Story 8.1's "immediately demonstrate value" spirit, extended) — reuses existing fixture files, does not fabricate new sample content.
- "Analyze" stays disabled while the textarea/dropzone/picker has no content, matching the existing `PasteBox` disabled-submit pattern.

**Testing approach**
- Component test: dropping a `File` object (jsdom's drag-and-drop + `FileReader` support is limited — use Testing Library's `fireEvent.drop` with a mocked `DataTransfer`, or move this specific assertion to e2e if jsdom can't exercise the real `FileReader` path) results in the same `analyzed` state a paste would.
- e2e test using Playwright's real file-chooser API (`page.setInputFiles`) against an actual fixture file, extending `privacy-no-network-calls.spec.ts`'s pattern to assert zero outbound requests during a file-drop analyze — this is a new input path into the same guaranteed-client-side pipeline, so it needs its own explicit check, not an assumption that the existing paste-path guarding covers it (same reasoning Episode 17 used for its own new persistence code path).
- Each sample-loader button is tested against its real fixture file, asserting the specific rule it's meant to fire actually appears in the resulting findings/warnings.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A dropped/picked file that isn't a valid plan at all (wrong file type, or valid text but not a plan) | Same failure mode `PasteBox` already handles for pasted text | Route through the exact same `PlanParseError` handling `handleAnalyze` already has — never a second, divergent error path for the file-input case |
| A very large file dropped (multi-MB SQL Server XML, matching Story 16.2's 5MB-paste bounded-time test) | `FileReader.readAsText` on a large file is async — a naive implementation could show no feedback for a noticeable duration | Reuse Story 16.2's bounded-time reasoning; confirm the UI doesn't look frozen/unresponsive while the read completes |
| A binary or non-text file dropped by mistake | `FileReader.readAsText` on binary content produces garbage, not an exception | Confirm this still surfaces as the existing friendly `PlanParseError`-driven message (garbage text simply fails to parse as any known plan format) rather than a raw/confusing error |
| Drag-and-drop on a touch device | Meaningless interaction model on mobile, per spec §5 `1k`'s own note | Confirm the dropzone gracefully degrades to just the file-picker button below the mobile breakpoint (Story 18.12) — don't rely on drag events being reachable there |

### Story 18.6 — Error and edge-state treatments

As a user who pastes something that doesn't parse, I want a clearly-differentiated error treatment (can't proceed vs. partial result vs. informational), so I know at a glance whether the tool is blocked or just giving me a heads-up.

**Acceptance criteria**
- Three severities render with three distinct treatments per spec §5 `1e`: red left-rule (can't proceed), amber (partial result available), blurple/accent (informational) — never color alone; each carries a label/icon too, consistent with the mismatch/severity-ring "never color alone" rule established elsewhere in this codebase.
- All error copy continues to come directly from `PlanParseError.message` (`err.message` rendered as-is) — this story adds visual severity treatment around that text, it does not rewrite or template the message itself, and it never echoes raw pasted content (privacy-architecture skill).
- Estimate-only and parameter-sensitivity notes (PRD §3 commitments, already implemented as rule-engine findings) are visible directly in the result view, not only reachable via docs.
- Parsing is synchronous today (`analyzePlanText` has no `await` in its hot path) — if a "parsing…" indicator is added per spec §5 `1e`'s new-element note, it must reflect genuinely asynchronous work; if parsing stays synchronous, the spec's own instruction is to drop the indicator rather than fake a delay.

**Testing approach**
- Component tests asserting each of the three severities' visual treatment (class/attribute, not just presence of text) for representative cases: `PlanParseError` codes that are genuinely blocking (`NOT_A_PLAN`, `INVALID_JSON`) vs. a successful-but-partial result carrying an estimate-only or parameter-sensitivity finding.
- Regression: every existing test asserting on `data-testid="parse-error"` content continues to pass — this story changes surrounding treatment, not the underlying error-message contract.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan that parses successfully but the rule engine's parameter-sensitivity honesty note fires (SQL Server) | This is the specific "PRD §3 commitment, must be visible in the result" case the spec calls out by name | Confirm it renders as the informational (blurple) treatment inline in the result, not buried in the detail panel of one specific node only |
| Multiple simultaneous conditions (e.g. a truncated-but-still-partially-parseable Postgres text plan, which the existing `TRUNCATED_INPUT` fixtures cover) | Could plausibly want more than one severity treatment shown at once | Confirm the UI handles zero, one, or multiple simultaneous notices without them visually colliding or one silently suppressing another |

### Story 18.7 — Detail panel Beginner/Expert densities

As a user who opened a node's detail panel, I want the Beginner view to teach me and the Expert view to give me everything at once, matching spec §5 `1f`'s exact content rules, so the panel serves both a first-time user and someone who already knows what they're looking at.

**Acceptance criteria**
- Section order stays exactly as `DetailPanel.tsx` already has it — this story changes density per section, not ordering.
- Education (blurple tint, via the now-consolidated token from Story 18.1) and findings (severity left-rule) stay visually distinct per Story 6.2's original acceptance criterion — this redesign restyles that distinction, it does not merge the two back together.
- Beginner: long glossary definition plus when-it's-fine/when-to-look-closer (`glossary/entries.ts`), prose warning text (`Warning.longText`... actually `shortText` per the existing beginner/expert text-field split — confirm against `OperatorEducation.tsx`/`WarningsSection.tsx`'s existing implementation, don't re-derive which field belongs to which mode), curated stat rows, query correlation visible, raw attributes hidden.
- Expert: education collapsed to one line, rule id shown, full `buildStatRows()` output including gap rows, raw attributes expanded by default (a reversal of the existing collapsed-by-default `RawAttributes.tsx` behavior — confirm this is genuinely mode-conditional, not a blanket default change that would also affect Beginner).
- Gap rows keep the italic/muted treatment (an explicit "not available" state, never a fabricated zero) — this is the field catalog's own "genuine cross-engine gaps" principle (`docs/10-node-stats-field-catalog.md`), unchanged by the restyle.
- Cumulated-vs-per-execution timing fields stay separately labelled in both densities (an existing field-catalog distinction, not new to this story, but must survive the restyle).
- Escape closes the panel and returns focus to the triggering node card — not a focus trap. This already exists (`PlanGraph.tsx`'s `triggerElementRef`); confirm it survives the panel becoming an overlay-with-scrim below 1180px (Story 18.2).

**Testing approach**
- Component tests for each density's exact section content (Beginner shows X, hides Y; Expert shows Y, collapses X) against a representative multi-warning, multi-gap-field fixture.
- Regression: `RawAttributes.tsx`'s existing 500-field collapsed-by-default test (Story 16.1) needs a companion asserting the Expert-mode default is expanded instead, without breaking the Beginner-mode collapsed case.
- Accessibility: keep the existing Escape/focus-restoration test passing, and add one for the panel-as-overlay-with-scrim case (below 1180px) specifically, since a scrim changes the DOM structure the focus-restoration logic operates within.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A node with zero warnings, in Expert mode | Nothing to show in the findings section | Confirm this renders the existing "no findings" state (reused from Story 5.2's zero-findings copy per the findings-list precedent), not an empty gap |
| A node whose operator type has no glossary entry (`getGlossaryFallback`) | Beginner mode's "long definition" section has nothing engine-specific to show | Confirm the existing fallback content renders in both densities, appropriately collapsed in Expert |
| Switching Beginner→Expert while the panel is open on a node with a very large raw-attributes bag | Expert's new "expanded by default" rule could reintroduce the exact performance concern Story 16.1 fixed (memoization is what made the collapsed-by-default state cheap) | Confirm the Story 16.1 `React.memo`/`useMemo` guards still cover the expanded-by-default Expert case — expanding 500 fields by default must not reintroduce the open-latency regression that story fixed |

### Story 18.8 — Search & filter palette

As a user with a large plan open, I want to hit `/` or `⌘K` and jump straight to a node by name, table, or severity, so I don't have to visually scan a big graph.

**Acceptance criteria**
- Opens on `/` or `⌘K` (`Cmd/Ctrl+K`), per spec §5 `1h`.
- Searches `rawOperatorLabel`, relation name, `index.name`, and warning severity over `collectNodes(root)` — reuses that existing traversal helper (`parsers/normalize.ts`), not a second tree-walk.
- Non-matching nodes drop to 32% opacity rather than unmounting — same "never disappear from the DOM, dim instead" rule the graph-visualization skill already states for search/filter, now with the spec's specific opacity value.
- Selecting a result reuses the existing `focusNodeId` prop on `PlanGraph` (Story 13.1's mechanism, and the exact one Episode 14's synced-selection also builds on) — it already handles expanding collapsed ancestors; this story doesn't reimplement that.
- Filter chips are additive and share one source of truth with `FindingsList.tsx`'s two existing filter selects — not a second, independently-drifting filter-state implementation.

**Testing approach**
- Component test: typing a query dims non-matching cards (opacity, not removal — assert the DOM node count is unchanged) and highlights matches.
- Component test: selecting a search result opens that node's detail panel and expands any collapsed ancestor, reusing the existing `findCollapsedAncestors`-based test pattern from Story 13.1's `FindingsList` tests.
- e2e test: `/` and `⌘K` both open the palette from anywhere on the page (not just while a specific element has focus), and `Escape` closes it.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `/` pressed while a text input (the paste textarea, or the palette's own search field) has focus | `/` is a printable character — it should type into the field, not hijack it as a global shortcut | Guard the global `/` handler to only fire when no text-input element currently has focus (standard pattern; `⌘K` doesn't need this guard since it's not a printable character in an input) |
| A query matching zero nodes | Every node would dim to 32%, which could read as "broken" rather than "no matches" | Show an explicit "no matches" state in the palette itself, distinct from the dimmed-graph state |
| Canvas mode active (300+ node plans) when search is used | Canvas has no DOM nodes to dim via opacity — `canvasDraw.ts` draws directly to pixels | Confirm search/highlight has a real canvas-mode equivalent (redraw with matched/dimmed treatment baked into the paint call, same "state shared between canvas and accessible-list views" rule Episode 15 established) rather than silently doing nothing above the canvas threshold |

### Story 18.9 — Guided walkthrough mode

As a beginner user, I want a full-screen, one-node-at-a-time walkthrough of my plan in execution order, so I can understand it as a narrated sequence instead of having to know where to start reading a graph.

**Acceptance criteria**
- New component directory `src/graph/walkthrough/`. Full-screen focus mode; the graph dims behind it (not hidden — spec §5 `1g` says "graph dimmed behind," not replaced).
- Step order is a post-order traversal of the `PlanNode` tree (leaves/execution order first), filtered to nodes carrying a warning or ≥10% contribution (reusing `computeContributionPercent.ts`, Episode 6's existing contribution-% logic — not a new percentage calculation), root always included regardless of the filter.
- Narration is generated from the same `glossary/` + `Warning.shortText` data the detail panel already uses — explicitly **not** a second content-authoring surface, per the graph-visualization skill's own existing rule for this exact feature ("Reuses `Warning.shortText`/`longText` from the rule engine — this must never become a second content-authoring surface with its own copy").
- Beginner mode by default when entering the walkthrough; entering from Expert keeps the toggle available but shortens the narration (reusing Story 18.7's density split, not a third density).
- Keyboard: `←`/`→` step through, `Esc` exits, focus lands on the step heading on each advance (an explicit, testable focus-management requirement, not assumed to fall out of DOM order).
- Exiting returns to the shell with the last-viewed node selected in the detail panel — reuses the `focusNodeId` mechanism again, consistent with Story 18.8's reuse of the same plumbing.

**Testing approach**
- Unit test for the step-order/filter logic in isolation (pure function over a `PlanNode` tree + `PlanContext`, independent of the walkthrough's rendering) — mirrors how `buildGraphElements.ts` and the rule engine are both tested as pure logic separate from their React wrappers.
- Component test: `←`/`→`/`Esc` keyboard behavior, and that exiting mid-walkthrough opens the detail panel on the correct (last-viewed) node.
- Content-source test: assert the walkthrough's narration strings are drawn from the same `glossary`/`Warning` data as the detail panel for a representative node — literally comparing the two rendered strings — as a regression guard against the "second content-authoring surface" drift the skill warns about.
- e2e test walking through a real multi-warning fixture start to finish, confirming the graph is visible-but-dimmed behind the full-screen overlay throughout.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan where nothing meets the ≥10%-contribution-or-warning filter beyond the root itself | The walkthrough would be a one-step tour, which may read as broken rather than "this plan is small/clean" | Render an honest single-step "nothing else stood out" state rather than an empty or confusing sequence |
| A very deep, narrow plan (Story 16.2's documented "pathologically deep chain" edge case, already a known limitation for the recursive tree-builders) | Post-order traversal over such a tree has the same recursion-depth exposure the parsers already flagged as a known limitation | Reuse Story 16.2's existing framing (already degrades to a friendly error elsewhere, never a blank page) rather than treating this as a new problem to solve from scratch in the walkthrough specifically |
| A shared-reference (multi-parent) node, e.g. Snowflake's CTE case | Post-order traversal of a DAG needs the same "visit once" dedup `collectNodes`/`buildGraphElements` already implement | Reuse the existing dedup-by-id pattern rather than re-deriving traversal semantics for what is still, underneath, the same DAG those other traversals already handle correctly |
| User switches Beginner↔Expert mid-walkthrough | Narration length changes; the current step shouldn't reset or feel jarring | Confirm the step position is preserved across the mode switch — only narration length/density changes |

**Retrofit (Story 20.6, found via manual testing on a large SQL Server stored-procedure batch)** — user's own framing: "any intern developer should be able to understand the complex execution plan based on the walk through." Two real gaps found and fixed:

1. **Name mismatch bug**: `buildStepNarration`'s `displayName` used the glossary's generic, engine-agnostic `entry.displayName` ("Append") instead of `node.rawOperatorLabel` ("Concatenation", SQL Server's own term) — the ONE surface in the whole app that didn't show the raw label; the graph card, detail panel, and findings list all consistently do. An intern reading "Step 2: Append" then looking at a graph node labeled "Concatenation" had no way to tell they're the same node. Fixed: `displayName` is now always `node.rawOperatorLabel`. `entry.displayName` is no longer read anywhere in the app.
2. **No visual anchor for a large multi-statement batch**: the walkthrough gave zero indication of which of a batch's 100+ statements it was touring, and never highlighted/panned the graph behind the dimmed overlay to the current step's node — it stayed frozen on whatever was selected before opening. Fixed additively: `WalkthroughOverlay` takes an optional `statementLabel` (shown under the step counter, only when the batch has more than one statement — no visual change for the common single-statement case) and an optional `onStepChange(nodeId)` callback fired on every step change including mount, wired to the SAME `focusNodeId` mechanism the walkthrough's own exit handler already used — not a second, parallel highlighting mechanism. A side effect (kept, not fought): the right-rail detail panel now stays live-synced to the current step while the walkthrough is still open, not just once on exit.

Verified live against the real motivating plan: heading now reads "Concatenation" (matching the graph node and the now-synced detail panel, all three consistent); the statement label under the step counter shows which of the batch's statements is being toured; the detail panel updates with every Next/Previous.

### Story 18.10 — Large-plan canvas mode: banner, degrade, and list toggle

As a user whose plan crosses the canvas-rendering threshold, I want the switch explained rather than just noticing a different-feeling graph, so a large plan doesn't feel like a worse or broken experience.

**Acceptance criteria**
- A banner explains the DOM→canvas switch when `allNodes.length > CANVAS_NODE_COUNT_THRESHOLD` (`PlanGraph.tsx`'s existing constant, currently 300 — unchanged by this story) — per spec §5 `1i`.
- Node labels below the legible-zoom floor (`canvasDraw.ts`'s existing text-fitting logic) degrade to solid heat-colored blocks with no text, rather than illegibly-small text.
- Selection in canvas mode is a drawn 2px accent-colored outline (`canvasDraw.ts`'s existing `SELECTED_OUTLINE_WIDTH`/`selectionColor` mechanism, restyled to the new accent token from Story 18.1) — there's no DOM focus ring to fall back on in canvas mode, so this outline IS the only selection indicator and must stay clearly visible against the new dark palette.
- The accessible-list toggle stays always-visible in the canvas toolbar (unchanged from Episode 15's "not buried" requirement); `AccessiblePlanList.tsx` still only mounts once opened.
- List indentation continues to equal depth; the collapsed-group row's hidden-count text stays byte-for-byte consistent with the graph's own collapsed-group placeholder node text (Episode 15's "single source of truth for what collapsed means" rule).

**Testing approach**
- Component/e2e test confirming the banner appears exactly when the canvas threshold is crossed and not below it, extending `canvas-large-plan.spec.ts`'s existing 320-node synthetic-plan pattern.
- Visual/pixel test (real browser, `getImageData` — jsdom has no real canvas 2d context, per the existing test file's own comment) confirming labels below the zoom floor actually render as solid blocks, not clipped/overlapping text.
- Regression: the existing canvas-mode accessibility test suite (screen-reader reachability, keyboard parity via `AccessiblePlanList`) must keep passing unmodified — this story restyles the banner/selection-outline/degrade behavior, not the accessibility contract Episode 15 already established.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan that hovers right at the threshold (299 vs. 301 nodes) across a collapse/expand interaction | The banner shouldn't flicker in and out as the user expands/collapses subtrees near the boundary | Confirm the banner's appearance is driven by the same `allNodes.length` (total nodes, not currently-visible/collapsed count) `PlanGraph.tsx` already uses for the DOM/canvas mode switch itself, so the two never disagree |
| The comparison view (Episode 14) running canvas mode on both panes independently, per that episode's own documented edge case | Two independent canvas instances, each needing its own banner/degrade/selection-outline state | Confirm this story's changes apply per-pane without assuming there's only ever one `CanvasPlanGraph` instance on the page at a time |

### Story 18.11 — Batch tabs, share link, and PNG export

As a user, I want richer statement tabs (duration + severity dot), the existing share-link long-warning treatment restyled, and a one-click PNG export of the graph, so I have a way to save/share a static view of what I'm looking at.

**Acceptance criteria**
- Statement tabs (`PlanReaderPage.tsx`'s existing `role="tablist"`, shown when `statements.length > 1`) gain a duration figure and a severity dot per tab — additive to the existing tab structure, not a replacement of the `role="tab"`/`aria-selected` contract already in place.
- Share link (`shareLink.ts`) keeps its existing behavior and long-link warning state (`share-link__message--warning`) — this story restyles it onto the new tokens, it does not change `encodeShareLink`/`decodeShareLink` logic.
- **New**: PNG export renders the `canvasDraw.ts` drawing path offscreen at export size and calls `toBlob()` — both the DOM/SVG and canvas rendering modes must export visually identically (per spec §5 `1j`, since `canvasDraw.ts` is already the single source of truth `PlanNodeCard.tsx`'s DOM styling is checked against for visual consistency), and nothing leaves the browser (a client-side `toBlob()` + download, no upload).

**Testing approach**
- Component test for the tab additions (duration/severity-dot presence and correctness against a representative multi-statement, multi-severity fixture).
- Unit test for the offscreen-canvas export function in isolation, asserting it produces a non-empty blob and that its content matches (pixel-sampling, similar to `canvas-large-plan.spec.ts`'s existing `getImageData` approach) what the visible canvas/DOM path renders for the same plan.
- Privacy check: extend `privacy-no-network-calls.spec.ts` with a PNG-export interaction, confirming zero outbound requests — a new user-triggered action producing a file is exactly the kind of new code path Episode 17 and Story 18.5 both required their own explicit check for, not an assumption.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Exporting a plan currently in DOM/SVG mode (below the canvas threshold) | The export path is specified as going through `canvasDraw.ts` regardless of which mode is currently on-screen | Confirm the offscreen render genuinely reuses `canvasDraw.ts`'s drawing functions (per the canvas skill's "layout and rendering stay separate, never fork" rule) rather than a second, DOM-screenshot-based export path that could visually drift from the canvas one |
| A collapsed plan (some subtrees hidden behind collapsed-group placeholders) | Exporting should reflect what the user is actually looking at | Confirm the export uses the current `collapsedIds` state, not a forced full-expand — matches what's on screen, not a hypothetical complete view |
| Export triggered on a very large (1000+ node) plan | Offscreen canvas at "export size" could be large/slow | Confirm this stays within a reasonable bounded time, following the same evidence-based-before-assuming-a-problem approach Story 16.2 used (measure before adding complexity like a size cap or a worker) |

### Story 18.12 — Mobile breakpoints

As a user on a phone, I want Findings to lead (not the graph), the detail panel as a bottom sheet, and every touch target ≥44px, so the tool is actually usable on a small screen rather than a scaled-down desktop layout.

**Acceptance criteria**
- Below 900px: input screen → result screen with Findings/Graph tabs → detail panel as a bottom sheet, per spec §5 `1k`. Findings tab is the default/leading one, not the graph — a phone can't usefully show a full node graph, per the spec's own reasoning.
- All touch targets ≥44px (buttons, tabs, the sheet's own controls).
- The bottom sheet replaces the fixed side detail panel below 480px specifically (spec notes this is "partly handled in `detailPanel.css`" already — confirm exactly what already exists there before rebuilding it).
- Paste stays the primary input on mobile; the file picker (Story 18.5) is a secondary button — drag-and-drop is not offered as an interaction on touch, per spec §5 `1k`.
- The existing mobile e2e assertions (`mobile-viewport.spec.ts`, `mobile-cpu-throttled.spec.ts`: hero/summary reachable without scrolling, detail panel visible/closable, real CPU-throttled responsiveness) all continue to pass against the redesigned layout — this story restyles/restructures mobile, it does not relax any of Episode 8/16's existing mobile commitments.

**Testing approach**
- e2e tests at the 900px and 480px breakpoints specifically (extending the existing `mobile-viewport.spec.ts` pattern, which already tests hero/summary/detail-panel usability at a mobile width) confirming the Findings-tab-leads, bottom-sheet, and drag-and-drop-absent behaviors.
- Touch-target size assertion (bounding-box height/width ≥44px) for the tab controls, sheet controls, and app-bar icon-only buttons from Story 18.2.
- Regression: rerun `mobile-cpu-throttled.spec.ts`'s real-CPU-throttling test against the redesigned mobile layout, since Story 16.2 measured this specifically with real throttling, not viewport-width emulation alone — this story's layout change shouldn't be assumed not to affect that without re-measuring.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A multi-statement batch (statement tabs, Story 18.11) on mobile | Two independent tab systems (statement tabs and the new Findings/Graph tabs) on one small screen | Confirm the two tab layers compose clearly (visually distinct levels) rather than reading as one confusing row of tabs |
| The guided walkthrough (Story 18.9) entered from mobile | A full-screen overlay on top of an already-narrow mobile layout | Confirm the walkthrough's keyboard-first interaction (←/→) has a touch equivalent (swipe or visible next/prev buttons) on mobile — the spec doesn't call this out explicitly, so treat it as a real gap to resolve during implementation, not to silently ship keyboard-only on a touch device |
| Rotating a phone mid-session (portrait↔landscape) | Breakpoint-driven structural changes could re-trigger unexpectedly | Confirm state (open detail panel, active tab, scroll position) survives an orientation change rather than resetting |

### Story 18.13 — Content stack

As a user who opened a node and wants to learn more, I want a small, editorially-distinct panel linking to related @scalingbackend content (blog/video), so I have a next step beyond the built-in glossary.

**Acceptance criteria**
- New `src/app/content/ContentStack.tsx` + `src/app/content/posts.ts` with the exact shape from spec §5 `2c`: `{id, kind:"blog"|"video", title, url, minutes, operatorTypes[], ruleIds[]}`.
- Placement matches on the open node's `operatorType` or a fired `Warning.ruleId`; renders nothing when there's no match — additive, never a required section.
- Visually distinct from the pgsuite/QueryDoc funnel callout (Episode 9: teal, a product nudge) — this is neutral/editorial styling, and the two are never rendered stacked adjacent to each other in the same panel.
- `posts.ts` starts with **zero entries** — per spec §5 `2c`'s explicit instruction ("Do not ship invented links; render the stack only once `posts.ts` has real entries") and this project's existing rule against fabricated placeholder content (Episode 12.1's "do not fabricate placeholder links claiming to be real content"). The component itself is fully buildable and testable now; the content is a separate, later fill-in (tracked against Episode 12.1's same real-URL blocker) — this story is not blocked by that, only its content data is.
- External links open in a new tab with `rel="noopener"`. No analytics/tracking call on click — a click-tracking beacon would breach the no-network-call guarantee (privacy-architecture skill) the same as any other outbound request would.

**Testing approach**
- Unit test for the match/placement logic against a synthetic `posts.ts` fixture (not the real, currently-empty one) covering: match by `operatorType`, match by `ruleIds`, and the empty/no-match render-nothing case.
- Component test confirming zero network requests fire on rendering or clicking a content-stack entry (extends the same pattern `privacy-no-network-calls.spec.ts` already uses elsewhere).
- Regression test asserting the real, shipped `posts.ts` and the funnel-callout component (`funnelCallouts.ts`) are never both visible in the same detail-panel render for the same node — a structural test, not just a visual convention.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `posts.ts` empty (the real, shipped starting state) | The component must not error or render a broken-looking empty section | Confirm `ContentStack` renders `null`/nothing entirely when there are zero entries, not an empty-but-visible container |
| A node matching multiple posts | Which one(s) to show, and how many | Cap at a small number (e.g. 2-3) rather than an unbounded list, consistent with this project's general "cap with an option to expand" pattern used elsewhere (Story 5.1's per-node warning cap) — exact number is an implementation decision, not specified by the spec |
| A post's `operatorTypes`/`ruleIds` referencing a value that no longer exists (a rule renamed, an operator type remapped) | Silent content drift as the rest of the codebase evolves | Add the same kind of "seen but unmapped" tracking the `plan-normalization` skill already requires of operator-type tables, applied here to `posts.ts` entries referencing stale `ruleIds`/`operatorTypes` |

### Story 18.14 — Comparison view: restyle onto the new shell

As a user comparing two plans (Episode 14), I want the comparison view to use the same dark tokens, node encoding, and shell conventions as the rest of the redesigned app, so it doesn't look like a leftover screen from a different product.

**Acceptance criteria**
- `src/graph/comparison/PlanComparisonView.tsx` and its CSS move onto the Story 18.1 consolidated tokens and Story 18.4 node encoding (severity ring, operator icons, orthogonal edges) — the three comparison states (changed/added/removed) keep their own distinct treatment (Episode 14's explicit "never one generic 'different' highlight" requirement) using colors drawn from the same consolidated palette, not reinvented.
- The app-bar gets a "Compare" action (spec §8's own suggested touch point) that opens the *existing* second-plan input flow (`ComparePasteBox.tsx`), not a new one — this story is a restyle/relocation of the entry point, not a rebuild of the comparison feature.
- **Explicitly not in scope for this story** (see this episode's goal-section cross-check): redesigning the comparison interaction itself into spec §8's "full-screen modal, not a route change" — that description was written before Episode 14 shipped a working side-by-side-panes UI, and spec §8 itself says "not designed." Keep the existing side-by-side/stacked-toggle interaction (`PlanComparisonView`'s current `orientation` state) as-is; only the visual treatment changes in this story.

**Testing approach**
- Regression: every existing `PlanComparisonView.test.tsx` and `e2e/plan-comparison.spec.ts` test continues to pass — this story changes tokens/styling, not the component's behavior or test ids.
- Visual check that the three comparison states remain distinguishable (not just individually styled) against the new dark palette — a colorblindness-simulator pass, same requirement Story 18.4 applies to the base node encoding.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| The "Compare" app-bar action's relationship to Story 18.2's shell/breakpoints | Where does a two-pane comparison fit in a shell designed around one canvas track? | Cross-reference Story 18.2's own edge case about this — don't resolve it twice independently; if 18.2 already answered it, this story just applies that answer to the restyled comparison view |
| A future real redesign of the comparison interaction (spec §8's modal concept) | This story deliberately doesn't attempt it | Leave a clear note in code (mirroring this story's own scoping) that the interaction model is a known, deliberate gap — not silently closed by this restyle — so a future session doesn't assume spec §8 is already fully implemented just because the visuals match |

## Episode 19 — Single persistent shell (retires the separate hero landing page)

Source: a user-supplied screenshot of the "2a" mockup (`docs/12-ui-redesign-spec.md`'s own `PlanReader UI Mockups.dc.html`, Claude Design project `6817789b-9d6f-4d9e-8021-133a1c3fd741`) taken directly from this app's own rendering of that mockup section, with an explicit instruction: make this the app's **only** page. Confirmed with the user (2025 session, AskUserQuestion): before any plan is pasted, the app bar and three-column shell render immediately — Plan Input lives in the left rail from the very first paint, the centre canvas shows a plain "paste a plan to get started" placeholder (not the marketing hero), and the right rail stays empty. No separate hero-then-shell split survives this episode.

**This directly supersedes Episode 8, Story 8.1's acceptance criterion** ("Hero + engine badges paint above the fold with no loading gate") **and `docs/12-ui-redesign-spec.md` §7's own constraint** ("Hero copy matches `positioningCopy.ts` character for character, above the fold, no loading gate") — both written when this app's default view was a full-page paste form, before the shell existed at all. This is a genuine, user-directed, spec-superseding decision, not a silent regression: flagged here, in `docs/00-memory-map-and-context.md`, and in-code at every place the old hero rendered. `positioningCopy.ts`'s `HERO_HEADLINE`/`HERO_SUBHEADLINE`/`SUPPORTED_ENGINES` exports are left in place (Story 8.1's own AC about matching the brief is still technically true of the source-of-truth file) but are no longer imported/rendered by `PlanReaderPage.tsx` — a future episode revisiting first-time-visitor credibility should start from that file, not re-derive the copy.

### Story 19.1 — Plan Input moves into the left rail; the shell is the only page

As a returning user (and a first-time visitor), I want the app's structure to be the same shell at every point in the session — paste, analyze, re-analyze a different plan — rather than a full-page paste form that gets replaced wholesale once a plan loads, so the tool feels like one persistent workspace instead of two different screens stitched together.

**Acceptance criteria**
- `.plan-shell` (app bar + three-column grid) renders unconditionally, on first paint, with no plan analyzed yet — not gated behind `analyzed &&` the way it is today.
- Left rail: Plan Input (the existing `PasteBox.tsx` — dropzone, file picker, sample buttons, textarea, Analyze, privacy statement, don't-save/clear-saved-data controls, all UNCHANGED behavior) renders above Findings, per `docs/12-ui-redesign-spec.md` §2's own left-rail description ("Plan input ... over Findings") — the exact placement Story 18.5 explicitly deferred ("PasteBox stays in its current pre-shell position above until [the plan-input-in-the-rail work happens]"). `RestoreSessionBanner` and `RecentPlansList` move into the same rail, directly below Plan Input, above Findings.
- A "New plan" control (matching the mockup's own labeling) clears the current `analyzed` state and returns to the empty-centre placeholder without touching what's saved in local persistence — starting over, not deleting saved data (that's still the existing separate "Clear saved data" control's job).
- Findings renders in the SAME rail, below Plan Input, only once a plan exists — not a second, competing "Plan Input" section once analyzed.
- Centre canvas: no plan yet renders a plain, honest empty-state message ("Paste a plan to get started" or equivalent — not the retired hero copy) in place of the summary/metrics-strip/graph, which appear exactly as before once a plan exists.
- Right rail: empty (no `DetailPanel`) until a node is actually opened, same as today — this story doesn't change detail-panel behavior, only that the rail it lives in is now always mounted.
- App-bar controls that only make sense once a plan exists (engine badge, Beginner/Expert, "Walk me through it", Compare, Share, Export, statement tabs) stay hidden/absent (not disabled-and-visible) until `analyzed` is truthy — the brand mark is the only thing guaranteed to render from first paint.
- Every existing behavior this story doesn't explicitly change — share-link recovery on load, local-session-restore banner, recent-plans list, comparison mode, search palette, guided walkthrough, PNG export, mobile breakpoints, all Episode 18 responsive behavior — continues to work exactly as before, just inside a shell that's now always present instead of conditionally mounted.

**Explicitly deferred, not silently dropped** (both real details visible in the source mockup, neither essential to "single persistent page"):
- The mockup's collapsed source preview (a "pasted · N lines" summary box with an expand affordance, replacing the raw textarea once a plan is loaded) — `PasteBox.tsx`'s textarea stays visible and editable at all times in this story; collapsing it is a real, separate UI-polish item for a later pass.
- The mockup's "New plan" control styling/exact placement — implemented functionally (clears `analyzed`), not pixel-matched to the mockup's own link styling.

**Testing approach**
- Component tests: the shell (app bar, three-column grid, Plan Input in the left rail) renders with no plan analyzed; Findings/graph/detail-panel/statement-tabs/compare/share/export are all absent pre-analysis; analyzing a plan (via paste, file, sample, or share-link recovery) populates the centre/right without unmounting Plan Input; "New plan" returns to the empty state while leaving saved/recent-plan data untouched.
- Regression: every existing `PlanReaderPage.test.tsx` test that asserted on the OLD hero-then-shell split is updated to the new structure, not deleted — same "update to the redesigned behavior, don't quietly drop coverage" rule Story 18.12 already established for its own mobile-default-tab regression.
- e2e: `positioning.spec.ts` (hero-above-the-fold assertions) is retired/rewritten to check the NEW default view instead (shell + Plan Input above the fold, no loading gate) rather than left asserting on copy that no longer renders; `plan-shell.spec.ts`, `mobile-viewport.spec.ts`, `mobile-breakpoints.spec.ts`, `mobile-cpu-throttled.spec.ts`, `plan-input.spec.ts`, `plan-analysis.spec.ts`, `plan-comparison.spec.ts`, `local-persistence.spec.ts`, `privacy-no-network-calls.spec.ts` audited for any assumption tied to the old structure (e.g., navigating and immediately finding `paste-textarea` outside a shell) and updated where needed.
- Visual regression: `visual-regression.spec.ts`'s existing baselines (`.plan-graph`, `.detail-panel`) are unaffected in content (same components, same test ids) but re-captured and visually inspected since their surrounding layout context changed.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A share-link fragment recovers a plan on first load | The shell must show the ANALYZED state immediately, not flash the empty-centre placeholder first | `loadFromLocationHash()` already resolves synchronously before first paint — confirm the initial `analyzed` state feeds straight into the always-mounted shell with no intermediate empty frame |
| Pasting/analyzing a SECOND plan without clicking "New plan" first (just editing the textarea and clicking Analyze again) | Must still work exactly as today — "New plan" is a convenience reset, not the only way to load a different plan | Reuse the existing `handleAnalyze` path unchanged; "New plan" only needs to clear `analyzed` (and reset the shell-scoped UI state the existing per-plan reset effects already handle), not reimplement analysis |
| Mobile breakpoints (Story 18.12's Findings-leads-by-default rule) applied to a shell that's now visible BEFORE any plan exists too | The mobile tab system currently only mattered post-analysis | Confirm the empty-centre placeholder and Plan Input behave sensibly under the existing `isNarrowShell`/mobile tab logic — Plan Input is reachable at every breakpoint, not hidden behind a tab that defaults to a now-empty graph |
| Compare mode, entered before vs. after a plan exists | Compare only makes sense once a primary plan is loaded | Confirm the "Compare with another plan" app-bar action stays absent (not just disabled) until `analyzed` is truthy — same treatment as every other analyzed-only app-bar control this story already specifies |
| `RecentPlansList`/`RestoreSessionBanner` now living in a narrow rail instead of full page width | Both were originally styled for full-width placement | Confirm both remain legible/usable at rail width — same `flex-wrap`/narrow-container treatment `PasteBox.tsx`'s own CSS already uses, extended to these two if their current styling assumes more horizontal room |
## Episode 20 — Multi-statement batch usability (large stored-procedure plans)

Source: manual testing with a real SQL Server showplan XML for a large stored procedure (hundreds of statements — every `DECLARE`/`IF EXISTS`/control-flow line gets its own `<StmtSimple>` from SQL Server itself, not just the "real" queries). Two real bugs and one real usability gap found:

1. `plan-reader-page__statement-tabs` (`PlanReaderPage.tsx`) renders every statement as an equal-weight tab with no grouping/cap — hundreds of trivial control-flow statements bury the handful with real query plans and findings under a multi-row button grid before the graph is even visible.
2. Statement tab labels are the raw `StatementText` XML attribute truncated to 60 chars — SQL Server attributes leading `--` comment lines to the following statement, so labels frequently read as a stale code comment (`-- [Tom 4/6/2013][TFS 5010] Put sublines...`) instead of the statement's actual SQL.
3. `PlanNodeCard.tsx`'s click handler calls `event.currentTarget.focus()` with no `{ preventScroll: true }` — the browser's default focus-triggered `scrollIntoView` walks up the ancestor chain including the outer page, so clicking a graph node can silently scroll the whole page back toward the top of the shell. Same missing option on `PlanGraph.tsx`'s panel-close focus-restore and `DetailPanel.tsx`'s open-focus call.

### Story 20.1 — Group trivial statements in the batch tab strip; fix comment-glued labels

As a user pasting a large stored-procedure plan, I want the statement tabs to lead with the statements that actually have a real query plan or a finding, with the mass of trivial control-flow statements collapsed out of the way, so I can find what matters without scrolling past hundreds of `cost 0` buttons first.

**Acceptance criteria**
- A statement is "trivial" iff `statementSeverity(root)` is `undefined` AND `formatStatementDuration(root)` is `undefined` or reports `"cost 0"` — reuses the existing two pure helpers in `statementTabSummary.ts` rather than a third, independently-drifting definition of "nothing interesting here."
- Consecutive trivial statements collapse into a single `"N control-flow statements — expand"` entry in tab order (adjacency-preserving, same reasoning `AccessiblePlanList`'s collapsed-group rows already use for collapsed graph subtrees) — a non-trivial statement between two trivial runs still gets its own full tab, never swallowed into a group.
- Clicking a collapsed-group entry expands it in place (same tab strip, same position) — expansion state is local UI state, not persisted, and resets when a new plan is analyzed (mirrors `collapsedIds`' reset-on-new-plan behavior in `PlanGraph.tsx`).
- The currently ACTIVE statement's own tab is never hidden inside a collapsed group — if `activeStatementIndex` points at a statement inside a would-be-collapsed run (e.g. restored from a share link or `Recent plans`), that run renders already-expanded.
- `truncateLabel`'s input has any leading `--`-prefixed comment lines stripped first (each line trimmed and checked, stopping at the first non-comment, non-blank line); if stripping leaves nothing, fall back to `Statement N` exactly as the existing empty-`statementText` case already does — not a blank tab.
- A batch with ≤1 statement (today's single-`SELECT` case) is completely unaffected — no grouping UI renders (matches the existing `analyzed.statements.length > 1` gate).

**Testing approach**
- Unit tests in `statementTabSummary.test.ts` for the new `isTrivialStatement`/grouping function (adjacency grouping, active-statement-forces-expand, all-trivial, no-trivial edge shapes) and `analyzePlan.test.ts` for comment-stripping (single comment line, multiple stacked comment lines, comment-only statement text, no leading comment).
- Component test in `PlanReaderPage.test.tsx`: a synthetic multi-statement batch with a mix of trivial/non-trivial statements renders a collapsed-group entry, expands on click, and always shows the active statement's real tab.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Every statement in the batch is trivial | A degenerate but real input (e.g. a proc that's pure control-flow with one tiny query) | The whole tab strip is one collapsed-group entry; expanding it reveals all of them — never an empty tab strip |
| A trivial run is a single statement | Collapsing a "group of 1" into an expand-click adds friction for no clutter savings | Only collapse runs of 2+ consecutive trivial statements; a lone trivial statement between two non-trivial ones keeps its own plain tab |
| `activeStatementIndex` restored (share link / Recent plans) to an index inside a long trivial run | The active tab must stay visible without a forced click-to-expand | Compute the grouping AFTER checking which run (if any) contains `activeStatementIndex`, and pre-expand that one run only — other trivial runs stay collapsed |

### Story 20.2 — Fix unwanted page-scroll on node click / panel close (missing `preventScroll`)

As a user clicking through a large plan's nodes, I want the page to stay exactly where I left it, so that clicking a node doesn't yank my scroll position away from the tab I was just looking at.

**Acceptance criteria**
- `PlanNodeCard.tsx`'s `handleClick` calls `event.currentTarget.focus({ preventScroll: true })`, not the bare `.focus()`.
- `PlanGraph.tsx`'s `closePanel` restores focus via `triggerElementRef.current?.focus({ preventScroll: true })`.
- `DetailPanel.tsx`'s open-focus effect uses `closeButtonRef.current?.focus({ preventScroll: true })`.
- `WalkthroughOverlay.tsx` and `SearchPalette.tsx`'s own focus calls are deliberately left unchanged — those modals' whole point is bringing the user's attention (and viewport) to newly-opened content, so browser auto-scroll-into-view there is correct, wanted behavior, not this bug's pattern.
- **Correction after re-checking the code** (initial manual-testing report suspected a missing scrim below the shell's 1180px overlay breakpoint): `.plan-shell__detail-scrim` (`planReaderPage.css`, wired in `PlanReaderPage.tsx` with `onClick={detailPanel.onClose}`) already exists and is already correct — Episode 18 Story 18.2 built it. What actually reads as "no scrim" on the dark theme is `rgba(0,0,0,0.5)` over an already near-black background being low-contrast, not a missing element. No code change from this bullet; left here so a future session doesn't re-"fix" something that already works.

**Testing approach**
- Component test: clicking a `PlanNodeCard` asserts `focus` was called with `{ preventScroll: true }` (spy on `HTMLElement.prototype.focus`), not just that focus moved.
- e2e: in a real browser, scroll the page partway down a long statement-tab strip, click a graph node, and assert `window.scrollY` is unchanged (the concrete regression this story fixes) — this needs a real browser (`e2e/`), not jsdom, since jsdom's `focus()` never scrolls at all and so can't reproduce the bug it's guarding against.
- e2e (narrow viewport): resize below 1180px, open a node's detail panel, assert a scrim is present and clicking it closes the panel.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A browser/environment where `focus({ preventScroll: true })` isn't supported (very old browsers) | Should degrade to today's behavior, never throw | The option is silently ignored by unsupporting browsers per the DOM spec — no feature-detection needed, but confirm no TypeScript lib-target issue makes this a compile error |
| Keyboard activation (Enter/Space) of a node card, vs. mouse click | The keyboard path (`handleKeyDown` in `PlanNodeCard.tsx`) doesn't call `.focus()` itself — the element already has focus by the time Enter/Space fires | Confirm the keyboard path was never affected by this bug and stays that way — this story's fix is scoped to the two explicit `.focus()` call sites, not a speculative third one |

### Story 20.3 — Add a way back: collapse an expanded control-flow group

Source: manual testing found Story 20.1 shipped one direction of the toggle only — clicking "N control-flow statements — expand" replaced that single button with N individual tabs, and nothing else took its place. There was no control left anywhere to collapse the run back once expanded.

As a user who expanded a large control-flow group by mistake (or is done looking at it), I want a way to collapse it back to the single summary row, so expanding isn't a one-way action that permanently re-clutters the tab strip.

**Acceptance criteria**
- `StatementTabRow`'s `"group"` variant gains an `expanded: boolean` field. An expanded run renders its OWN group row (now reading "Collapse N control-flow statements") immediately before the individual tab rows it reveals, instead of the group row disappearing entirely.
- Clicking that row while expanded removes the run's `start` from `expandedStatementGroups`; clicking it while collapsed adds it — the same row, both directions, matching a disclosure-widget's usual behavior rather than a one-shot button.
- A run forced open because the active statement sits inside it (not because the user explicitly expanded it) still shows the same "Collapse" control — clicking it removes any explicit expansion but the run correctly stays visually expanded if the active index is still inside it (the existing "never hide the active tab" invariant from Story 20.1 is unchanged, not weakened by this story).
- `aria-expanded` on the group button reflects state, for assistive tech and for tests.

**Testing approach**
- Unit tests (`statementTabSummary.test.ts`): an expanded run's rows include its own `{ expanded: true }` group row ahead of the individual tabs; collapsing (empty `expandedRunStarts`) with the active index elsewhere returns to a single collapsed group row; collapsing while the active index is still inside the run stays expanded (never hides the active tab).
- Component test (`PlanReaderPage.test.tsx`): click to expand, assert the button now reads "Collapse N control-flow statements" with `aria-expanded="true"`, click again, assert it's back to "N control-flow statements — expand" with the 2 original tabs.
- Verified live against the real ~300-statement plan that motivated Episode 20: expand a 44-statement run, collapse it back, tab strip returns to its original 8-row state.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Collapsing a run while the active statement sits inside it | Must never hide the tab the user is currently looking at | `buildStatementTabRows`'s existing `activeInsideRun` check is unioned with `expandedRunStarts.has(start)` for the `expanded` flag — removing from `expandedRunStarts` alone doesn't force a hidden active tab |
| Rapidly toggling expand/collapse | Shouldn't accumulate stale state or throw | Plain `Set` add/delete on each click, same pattern the original expand-only version already used — no new state shape to get inconsistent |

### Story 20.4 — Findings panel covers the whole batch, not just the active statement

Source: manual testing — `FindingsList` was wired to `activeStatement.root` only. On a large stored-procedure batch, findings on every OTHER statement (including info-level plan-wide notes sitting inside a currently-collapsed control-flow group) were completely invisible unless the user clicked into that exact statement's tab first.

As a user reviewing a large multi-statement batch, I want the Findings panel to show issues from every statement, not just whichever one I happen to have open, so I don't have to click through dozens of statements one at a time to find out what's actually wrong with the batch.

**Acceptance criteria**
- `src/rules/findings.ts` gains `collectFindingsAcrossStatements(sources: FindingsSource[])` — merges `collectAllFindings` across every statement's root, tags each finding with its `statementIndex`/`statementLabel`, sorts by severity across the whole merged list (not grouped by statement first).
- The two plan-wide honesty-note rule ids (`parameter-sensitivity-honesty-note`, `estimate-only-plan`) are deduped to their FIRST occurrence across statements — they restate the same batch-wide fact on every statement's own root, and merging ~100+ statements without this would show the same two sentences ~100+ times, which is worse noise than the single-statement view this story replaces, not better. Every other finding (including two different statements independently triggering the SAME ruleId on a real, distinct node) is never deduped — only these two specific plan-wide rule ids are special-cased.
- `FindingsList` takes `sources: FindingsSource[]` and `activeStatementIndex: number` instead of a single `root`; `onSelectNode` now receives `(statementIndex, nodeId)`.
- A finding belonging to a statement OTHER than the currently active one shows a small italic statement-label badge; a finding on the active statement shows no badge. The badge is never rendered at all for a single-statement batch (`sources.length === 1`) — visually identical to the pre-Story-20.4 single-statement view.
- Clicking a finding from a different statement switches `activeStatementIndex` to that statement (reusing the exact same `switchToStatement` reset logic the statement-tab click handler already uses — matched-node-search state and the walkthrough both reset, since they're keyed to a specific tree) AND focuses the originating node — the centre graph must show the CORRECT tree before `focusNodeId` is applied to it, not silently fail to find a node id from a different statement's tree.
- Filter (severity/category) reset logic keys off the SET of statement roots changing (object identity of each root, not just an equal count) — switching which statement is active must never reset an in-progress filter, but a genuinely new plan (including a re-paste producing the same statement count) must.

**Testing approach**
- Unit tests (`findings.test.ts`): merging across statements, severity-first sort across the merge, honesty-note dedup (5 statements × 2 notes → exactly 2, not 10, not 0), a REAL per-statement finding sharing a ruleId across two statements is NOT deduped, single-source behavior is identical to plain `collectAllFindings`.
- Component tests (`FindingsList.test.tsx`): multi-statement merge count, badge shown only on non-active-statement findings, no badge at all for a single-statement batch, clicking a cross-statement finding calls `onSelectNode` with that finding's own statement index (not the active one), filter-reset-on-root-set-change.
- Verified live against the real motivating plan: Findings count went from 3 (one statement) to 9 (whole batch, honesty notes deduped); clicking a badged finding switched the active tab, re-rendered the correct small graph, and opened the correct node's detail panel in one click.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| ~100+ statements each carrying the same two plan-wide info notes | Naive merging would flood the panel with duplicate sentences — the whole point of this story is LESS noise, not more | `PLAN_WIDE_RULE_IDS` dedup, first occurrence kept, in `collectFindingsAcrossStatements` |
| A finding on a statement sitting inside a currently-collapsed control-flow group | Clicking it must still work even though that statement's own tab isn't visible in the strip right now | `switchToStatement` only changes `activeStatementIndex`; `buildStatementTabRows` (Story 20.1) already guarantees a run containing the active index renders expanded on the very next render — no separate expansion bookkeeping needed here |
| Clicking a finding already on the active statement | Must behave exactly as before this story — no unnecessary state reset | `handleSelectFinding` only calls `switchToStatement` when the clicked finding's `statementIndex` differs from the current one |
| Two different statements each independently triggering the same ruleId (e.g. two unrelated `disk-spill` warnings) | Must NOT be mistaken for the plan-wide-note case and collapsed into one | Only the two specific, known plan-wide rule ids are ever deduped; every other ruleId is kept per-occurrence regardless of how many statements share it |
| Single-statement plans (Postgres, Snowflake, most SQL Server input) | Must render and behave exactly as before this story — no regression for the common case | `sources.length === 1` — no badges ever render, and `collectFindingsAcrossStatements` output is asserted identical to `collectAllFindings` for this case |

### Story 20.5 — Header honesty notes are plan-wide, not re-derived per active statement

Source: manual testing on the same large SQL Server stored-procedure batch — the two always-visible header notes (parameter-sensitivity, estimate-only) were filtered from `activeStatement.root.warnings` alone. Since the rule engine attaches these PLAN-WIDE facts to every statement's own root independently, switching between statements kept re-showing the exact same two sentences over and over — reported as the header "populating notes" on every click, on a batch with 100+ statements to click through.

As a user browsing a large multi-statement batch, I want the header's honesty notes to reflect the whole plan once, not flicker/re-derive every time I switch statements, so the header reads as a stable disclosure rather than noise that "keeps happening."

**Acceptance criteria**
- The two header `Notice` elements are sourced from `planWideNotices` — `collectFindingsAcrossStatements(findingsSources)` (Story 20.4's own whole-batch, deduped collector — the SAME dedup the Findings panel already uses, not a second independently-drifting definition) filtered to `parameter-sensitivity-honesty-note`/`estimate-only-plan` — instead of `activeStatement.root.warnings` directly.
- Switching the active statement never adds, removes, or re-renders these two notices differently — they render identically regardless of which statement is currently open, since they're batch-wide facts, not statement-specific ones.
- Single-statement plans (Postgres, Snowflake, most SQL Server input) are unaffected — `findingsSources` has one element, `collectFindingsAcrossStatements` on one source behaves identically to reading that one root's own warnings directly (already asserted by Story 20.4's own test for this).

**Testing approach**
- Component test (`PlanReaderPage.test.tsx`): a new 2-statement SQL Server fixture with no `RunTimeInformation` on either statement (both independently estimate-only) — asserts exactly one header notice exists, switches to the second statement's tab, asserts still exactly one (never zero, never two). Scoped specifically to the `.plan-reader-page__notice--info` class, since the same `shortText` also legitimately appears in the root node's own hover-tooltip and in the (global, Story 20.4) Findings list — this story is only about the always-visible header banner.
- Verified live against the real motivating plan: switching between statement tabs no longer changes the header's two notes at all — same position, same text, no flicker.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A batch where the same `shortText` legitimately appears in three places at once (header notice, root node's hover-tooltip, global Findings list) | A naive `getAllByText` assertion would wrongly read 3 as "duplicated," when it's 3 different, correct UI surfaces | Test scopes to `.plan-reader-page__notice--info` specifically, not raw text-content count |
| A theoretical batch where statements disagree on estimate-only status (some captured with actuals, some without) | Real single-capture showplans are always uniform on this — but the code shouldn't assume it | `collectFindingsAcrossStatements`'s existing "first occurrence" dedup naturally picks whichever statement shows the fact first; since the fact is true if ANY statement carries it, this is the correct, honest behavior even in that theoretical case |

## Episode 21 — Buffer/cache and disk-I/O efficiency rule

Source: user request ("include shared buffers based rule engine for postgres, and same equivalent for SQL Server and Snowflake"). The normalized `PlanNode.io`/`PlanNode.timeBreakdown` fields already carry this data for all three engines (Episode 6's field-catalog retrofit) — nothing in `ALL_RULES` (`src/rules/index.ts`) consumed it until this episode.

### Story 21.1 — `buffer-cache-inefficiency` rule: low buffer/cache-hit ratio (Postgres/SQL Server), high disk-I/O time share (Snowflake)

As a user with a Postgres, SQL Server, or Snowflake plan, I want the tool to flag an operator that's reading heavily from disk instead of cache/buffer memory, so I know a memory/index change (not just a query rewrite) might be the real fix.

**Acceptance criteria**
- Postgres and SQL Server share one code path: fires when `node.io.cacheHitRatio` is below `CACHE_HIT_RATIO_THRESHOLD` (0.9) AND `node.io.bufferReads` is at or above `MIN_BUFFER_READS_THRESHOLD` (1,000) — the volume floor exists so a handful of cold-cache reads on a small table never fires.
- Postgres wording states the ratio as exact (`Shared`/`Local Hit`/`Read Blocks`, present only when the plan was captured with `BUFFERS`); SQL Server wording explicitly calls the ratio an approximation (logical-vs-physical reads, per field catalog §5) — never presented with Postgres-level confidence.
- Silently doesn't fire (never a fabricated "0% cache hit") when `io` is absent entirely — the honest state for a Postgres plan captured without `BUFFERS`, per the field catalog's existing handling note.
- Snowflake has no per-node cache-hit field (query-level only, per field catalog §5) — its own signal is `node.timeBreakdown`'s `localDiskIoPercentage` + `remoteDiskIoPercentage` combined, fired when their sum is at or above `SNOWFLAKE_DISK_IO_PERCENTAGE_THRESHOLD` (20). Wording distinguishes remote-storage share (more severe — even the warehouse's own local SSD cache missed) from local-disk share.
- Registered in `ALL_RULES`, categorized under a new `"I/O issues"` `FindingCategory` (`findingCategory.ts`), so the findings-list category filter surfaces it without falling into the generic "General notes" bucket.
- Single severity (`warning`) — matches the MVP rules' own convention of reserving `critical` for the unambiguous disk-spill case.

**Testing approach**
- Unit tests (`bufferCacheInefficiency.test.ts`), `makeNode`/`makeContext`-based — same pattern `diskSpill.test.ts` already established: the rule is engine-agnostic over already-normalized fields, and each parser's own tests (`extendedFields.test.ts`, `parseShowplanXml.test.ts`, `parseOperatorStats.test.ts`) prove `io`/`timeBreakdown` are derived correctly from each engine's raw signal.
- **End-to-end ground-truth cross-check** (`analyzePlan.test.ts`): this repo has no separate fixture corpus with its own pre-existing analyzer to check against (there is no `tests/postgres/` directory) — the rule engine itself IS the analyzer. The honest equivalent is driving the real parse → rule pipeline against real fixture files, not just the rule's own `makeNode` unit tests: `low-buffer-cache-hit-ratio.json` (Postgres, fires), `simple-seq-scan.json` (Postgres, no `BUFFERS` captured, doesn't fire), `read-ahead-heavy-scan.xml` (SQL Server, doesn't fire — see Story 21.2).
- Both directions per engine: fires below threshold, doesn't fire at/above it, doesn't fire below the read-volume floor even at a 0% ratio, doesn't fire when the relevant field is absent.
- Numeric edge cases: NaN percentage, read counts summing past 100% (malformed/rounding-drift input) — never throws, never renders `NaN`/`undefined` into warning text.
- Full suite (905 tests) run to confirm no snapshot-test fixture accidentally already crosses these thresholds.

**Edge cases to handle** — checklist, one fixture + test per row
- [x] Postgres plan captured without `BUFFERS` — `io` is absent, not zero; a naive check could read `undefined` as `0%` and always fire → explicit `io === undefined` early-return, never fabricates a ratio. Fixture: `postgres/simple-seq-scan.json`. Test: `analyzePlan.test.ts` "does NOT fire buffer-cache-inefficiency on an ordinary Postgres plan with no BUFFERS data captured".
- [x] A tiny table with genuinely 0% cache hits (a handful of cold reads) — technically a "bad ratio" but not worth flagging → `MIN_BUFFER_READS_THRESHOLD` floor before the ratio is even considered. Test: `bufferCacheInefficiency.test.ts` "does NOT fire when read volume is below the noise floor, even at 0% hit ratio".
- [x] Snowflake node with only `remoteDiskIoPercentage` OR only `localDiskIoPercentage` set (not both) — the `??`-defaulted sum must not read as a comparison between a real number and a fabricated zero → both default to `0` via `??` before summing; a genuinely absent `timeBreakdown` object still short-circuits via `!tb` first. Test: `bufferCacheInefficiency.test.ts` "does NOT emphasize remote-storage severity when local disk dominates instead" (and the sibling positive test).
- [x] SQL Server's approximation caveat getting silently dropped if this rule's wording is ever edited later — field catalog §5 says logical-vs-physical is "approximate at best"; presenting it with Postgres-level confidence would overclaim → locked in by an explicit assertion. Test: `bufferCacheInefficiency.test.ts` "fires on SQL Server with approximate wording, not Postgres's exact wording".
- [x] A real Postgres plan with `BUFFERS` and a genuinely bad ratio, verified end-to-end (not just a hand-built `PlanNode`) — the rule must actually wire up through the real parser, not just look right in isolation. Fixture: `postgres/low-buffer-cache-hit-ratio.json` (500/45,500 hits, ~1%). Test: `analyzePlan.test.ts` "fires buffer-cache-inefficiency end-to-end on a Postgres plan captured WITH BUFFERS...".

### Story 21.2 — Exclude SQL Server read-ahead reads from the cache-efficiency signal

As a user with a SQL Server plan containing a large sequential scan, I want the tool not to flag read-ahead-driven physical reads as a cache problem, so a scan that's efficiently prefetching data isn't reported as if its buffer pool were under pressure.

Source: found while re-verifying this episode against `docs/10-node-stats-field-catalog.md` §5 and the parser skills — `RunTimeCountersPerThread`'s `ActualReadAheads` is a real, distinct SQL Server showplan attribute this parser wasn't reading at all. Read-ahead is SQL Server's own deliberate sequential-prefetch mechanism: pages pulled in because a scan is expected to need them next, not a buffer-pool miss the way an unplanned physical read is. Left unexcluded, a large efficient sequential scan (physical reads dominated by read-ahead) would misreport as a severe cache problem.

**Acceptance criteria**
- `PlanNode.io` gains `readAheads?: number` (`normalize.ts`), SQL Server-specific — documented as undefined for Postgres/Snowflake, same pattern as `bytesScanned`'s existing Snowflake-only doc comment.
- `parseShowplanXml.ts` sums `ActualReadAheads` across `RunTimeCountersPerThread` elements (same `sumThreadAttr` helper already used for `ActualLogicalReads`/`ActualPhysicalReads`) into `io.readAheads`, kept as a field separate from `io.bufferReads` — never folded into it.
- `bufferCacheInefficiency.ts`'s SQL Server path excludes read-ahead pages from the read count BEFORE both the volume-floor check and the ratio calculation: `nonReadAheadReads = max(0, bufferReads - (readAheads ?? 0))`, and the ratio itself is recomputed against that adjusted count (not `io.cacheHitRatio`, which still includes read-ahead pages as "reads").
- When read-ahead was actually excluded (`readAheads > 0`), the warning's `longText` discloses the exclusion and the excluded count explicitly — never a silently adjusted number with no explanation.
- `readAheads` is undefined for Postgres (no equivalent concept exposed by `EXPLAIN`) — the exclusion math is a no-op there via `?? 0`, verified identical output with/without an explicit `undefined` override.
- **Retrofit, found during a later detail-panel audit**: `buildStatRows.ts`'s "This node's numbers" section never surfaced `io.readAheads` at all — a scan whose `Disk reads` figure was mostly read-ahead showed a large, unexplained number with nothing in the panel connecting it to why `buffer-cache-inefficiency` correctly didn't fire. Added a "Read-ahead reads" row, right after "Disk reads", labeled `"N (prefetch, not a cache miss)"` — never folded into the `Disk reads` figure itself, same separation the rule and the parser already maintain.

**Testing approach**
- Parser unit tests (`parseShowplanXml.test.ts`): `ActualReadAheads` promotes to `io.readAheads` separate from `bufferReads`; `io.readAheads` stays `undefined` (not `0`) when the attribute is absent from `RunTimeInformation` entirely.
- Rule unit tests (`bufferCacheInefficiency.test.ts`) — **the single most important negative test case in this story**: a scan with a huge raw `bufferReads` count almost entirely explained by `readAheads` must NOT fire, even at `bufferHits: 0`.
- End-to-end (`analyzePlan.test.ts`): the same read-ahead-heavy scenario driven through the real `analyzePlanText` pipeline, not just the rule in isolation.

**Edge cases to handle** — checklist, one fixture + test per row
- [x] High `ActualReadAheads`, low TRUE `ActualPhysicalReads` (the critical negative case) — a scan can show catastrophic raw physical reads that are almost entirely prefetch, and must not be flagged. Fixture: `sqlserver/read-ahead-heavy-scan.xml` (500,000 physical reads, 499,500 read-ahead → 500 genuine reads, below the floor). Tests: `bufferCacheInefficiency.test.ts` "does NOT fire when physicalReads is high but almost entirely explained by read-ahead (the critical negative case)"; `analyzePlan.test.ts` "does NOT fire buffer-cache-inefficiency end-to-end on a SQL Server scan whose reads are read-ahead, not genuine misses".
- [x] Physical reads remain genuinely high even AFTER read-ahead is excluded — the exclusion must not become a blanket "SQL Server never fires" bug. Test: `bufferCacheInefficiency.test.ts` "DOES fire when physical reads remain high even after read-ahead is excluded" (10,000 genuine reads left out of 500,000 raw).
- [x] The disclosed read count in the warning text is the ADJUSTED figure, not the raw pre-exclusion one — a reader must never see a number that still silently includes pages the rule claims to have excluded. Test: `bufferCacheInefficiency.test.ts` same case, asserts `shortText` contains "10,000" and explicitly does NOT contain "500,000".
- [x] `readAheads` greater than `bufferReads` (malformed/inconsistent input — read-ahead reads are themselves counted as physical reads by SQL Server, so this shouldn't happen with real data, but a parser bug or hand-edited XML could produce it) — must floor at zero genuine reads, never go negative. Test: `bufferCacheInefficiency.test.ts` "treats readAheads greater than bufferReads... as zero genuine reads, not negative".
- [x] `readAheads` absent or `0` — no read-ahead disclosure clause should appear in `longText` when nothing was actually excluded. Test: `bufferCacheInefficiency.test.ts` "does not disclose a read-ahead note when readAheads is absent or zero".
- [x] Postgres nodes are completely unaffected — `readAheads` is a SQL Server-only field. Test: `bufferCacheInefficiency.test.ts` "has no effect on Postgres (readAheads is a SQL Server-only field, never populated there)".

**Note on scope, corrected against the original request**: a parallel ask for a Snowflake-side "query-level cache-hit percentage" field was investigated and NOT implemented — Snowflake's "percentage scanned from cache" statistic comes from `QUERY_HISTORY`/the Query Profile summary, a genuinely different data source than `GET_QUERY_OPERATOR_STATS()` (the only input this app's Snowflake parser accepts). It cannot be derived from the current single-paste input without a real scope decision (accepting a second paste from a different source and correlating the two) — not a small parser gap to close alongside this story. See `docs/10-node-stats-field-catalog.md` §5 and the `snowflake-plan-parsing` skill's own note on this, both added by this story. Snowflake's existing `timeBreakdown`-based signal (Story 21.1) stands as the real, already-available equivalent.

## Episode 22 — Fullscreen canvas with node-anchored detail popup

Source: user request — "add a fullscreen button on the canvas... when user clicks on it the canvas will be opened fullscreen window. and when user clicks on any node then it will have a dialogbox or popup at that node position showing its details... so for big plan user can view it in fullscreen window & details there only on click on each node."

### Feasibility: yes, buildable — with the real complexity concentrated in three specific places

1. **Fullscreen mechanism**: the browser's real Fullscreen API (`element.requestFullscreen()`) is the WRONG tool here, despite the word "fullscreen" in the ask — it requires a fresh user gesture, its own Escape-key behavior conflicts with this app's existing Escape-closes-overlay convention (`WalkthroughOverlay`, `SearchPalette`, `DetailPanel` all already bind their own Escape handler), it visually clips content outside the fullscreened element in ways that make co-existing overlays (search palette, walkthrough) unreliable across browsers, and it's difficult-to-impossible to drive from Playwright e2e tests. This app already has the RIGHT pattern for "fullscreen" built and proven three times over (`WalkthroughOverlay`, `SearchPalette`, the narrow-viewport `DetailPanel` overlay) — a `position: fixed; inset: 0` CSS overlay with a high z-index, no real Fullscreen API involved. **Confirmed with the user**: this feature means "maximize the canvas to fill the whole browser viewport" via this same CSS-overlay pattern, not literal OS/browser fullscreen.
2. **Node-anchored popup positioning** is real, non-trivial, net-new work — this app has never anchored a floating panel to a node's on-screen position before. It needs:
   - **DOM/SVG mode** (plans under `CANVAS_NODE_COUNT_THRESHOLD` = 300 nodes): React Flow's own `useReactFlow().flowToScreenPosition()` gives the node's screen coordinate directly — no new math needed, just calling an existing library API.
   - **Canvas mode** (300+ nodes — Episode 15's `CanvasPlanGraph.tsx`, drawn to a `<canvas>` with no per-node DOM element to anchor to at all): needs a NEW `worldToScreen()` function in `viewportTransform.ts` — the exact inverse of the existing `screenToWorld()` already there, same file, same testing pattern, genuinely small and mechanical to add, but currently **does not exist**. This matters more than it sounds: canvas mode is exactly what a "big plan" (the story's own stated motivation) triggers, so this isn't an edge case to defer — it's the primary case the feature exists for.
   - **Viewport-edge clamping**: a node near the edge of the screen needs the popup to flip/reposition so it never renders partially off-screen — a real "floating UI" positioning problem this app has never had to solve before (existing tooltips/popovers in this codebase — `nodeTooltip.ts`'s hover tooltip — are simple CSS-positioned relative to their own DOM node via `:hover`, not screen-coordinate-clamped).
   - **Staying anchored during pan/zoom**: **confirmed with the user**: the popup live-repositions every frame to keep tracking the node, rather than closing on pan/zoom. This is a smaller lift than it first sounds, because both rendering modes already re-render on every pan/zoom tick: DOM/SVG mode can pair React Flow's own `useViewport()` hook (which triggers a re-render on every viewport change) with `flowToScreenPosition()` so the popup's position is simply re-derived each render — no separate "track every frame" mechanism needed, this is React Flow's own documented pattern for screen-anchored overlays. Canvas mode already holds pan/zoom state in a `transform` value that changes on every `handlePointerMove`/`handleWheel` tick and re-renders on each change; deriving the popup's position via `worldToScreen(nodeWorldPosition, transform)` from that same state gets live tracking "for free" as a consequence of normal React re-rendering, not a bespoke animation loop.
3. **Scope relative to the existing right-rail/overlay `DetailPanel`**: `DetailPanel` already has three call sites (`PlanGraph`'s own default overlay render, each `PlanComparisonView` pane, and the app shell's right-rail `"shell"` variant) and an established `variant` prop pattern for exactly this kind of "same content, different chrome" need. The node-anchored popup is a NATURAL fourth variant (`"popup"`) reusing the exact same `DetailPanel` component and content — not a new content-authoring surface, matching this codebase's own repeated insistence (walkthrough, findings, tooltip) that detail content is authored once and only ever re-chromed, never re-copied. **Confirmed with the user**: the popup replaces the right-rail `DetailPanel` ONLY in maximized mode — the existing right-rail/overlay behavior in normal (non-maximized) mode, and inside `PlanComparisonView`, is completely unchanged by this episode.

### Story 22.1 — Maximize-to-viewport canvas mode

As a user working with a large or deeply-nested plan, I want to expand the graph to fill my whole screen, so cramped side rails and page chrome don't eat into the space I need to actually read the diagram.

**Acceptance criteria**
- A new toolbar control on the graph pane (alongside the existing zoom in/out/fit-view `Controls`, top-right — `PlanGraph.tsx`) toggles a maximize/restore state — **not** the browser's real Fullscreen API (see feasibility note above); a `position: fixed; inset: 0` overlay, matching `WalkthroughOverlay`'s own established pattern, with its own Escape-to-restore handler that doesn't conflict with `WalkthroughOverlay`/`SearchPalette`'s existing ones (only one of these overlay-like modes can sensibly be "the top one" at a time — define and test the interaction order explicitly, don't leave it as an unconsidered z-index accident).
- Maximized mode shows: the graph itself, its existing zoom/pan controls and node-search bar (`SearchPalette`'s trigger), Findings, the Beginner/Expert toggle, and Walk-me-through — **confirmed with the user: all of these stay reachable while maximized**, none are hidden or demoted. For a multi-statement batch, statement switching is **confirmed as a NEW compact dropdown** (not the existing full statement tab strip, which is too wide for a chrome-minimized maximized view) — this dropdown is itself new UI, fed from the same `analyzed.statements` data the tab strip already reads, and needs its own component/test coverage rather than being treated as a trivial re-skin of the tab strip.
- Restoring (via the same toggle, or Escape) returns to the exact prior scroll position, active statement, selection, and zoom/pan state — maximizing must never look like it silently reset anything.
- Works in BOTH rendering modes (DOM/SVG and Canvas — Episode 15) identically from the user's perspective, even though the underlying implementation differs per mode.
- Keyboard-reachable (a real button, not a hover-only affordance) and screen-reader-labeled, matching this app's existing accessibility bar for every other control.

**Testing approach**
- Component test: toggling maximize applies/removes the fixed-overlay class and preserves graph state (selected node, pan/zoom, active statement) across the toggle.
- Component test: Escape restores from maximized mode; explicitly test the interaction with an ALREADY-open `WalkthroughOverlay`/`SearchPalette` (which should "win" — this app's established stacking order — see z-index comments already in `walkthroughOverlay.css`/`searchPalette.css`) so Escape doesn't ambiguously close the wrong layer.
- e2e test: maximize on a real large (300+-node, canvas-mode) fixture, confirm the canvas actually re-renders at the new (viewport) size — canvas mode already has real-browser-only pixel-painting verification precedent (`e2e/canvas-large-plan.spec.ts`), reuse that pattern rather than inventing a new one.
- Mobile-width test (this app's own standing requirement — every layout-affecting story gets one, per the graph-visualization skill): maximize behavior at a narrow viewport, where the shell already collapses rails into tabs (Episode 18, Story 18.2's breakpoint).
- Component test: the new compact statement dropdown, shown only for a multi-statement batch while maximized, lists all statements and switching selection re-renders the maximized graph with the newly-selected statement's tree — same underlying `switchToStatement` data flow `PlanReaderPage.tsx`'s existing tab strip already uses, not a parallel one.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| Maximizing while a node's detail panel (right-rail or overlay) is already open | The panel and the newly-fixed graph overlay could z-index-fight or the panel could vanish confusingly | Explicit decision: does the panel stay open (as a floating panel inside maximized mode) or close? Pick one, state it, test it — don't leave it as whatever falls out of CSS by accident |
| Maximizing a multi-statement batch, then switching statements while maximized | The graph shown must update to the newly-active statement without silently exiting maximized mode | Statement switching inside maximized mode re-renders the SAME maximized `PlanGraph` instance with the new statement's tree — maximized-ness is UI chrome state, independent of which statement's data is currently loaded into it |
| Maximizing on a narrow/mobile viewport | The shell already has its own narrow-viewport tab system (Episode 18, Story 18.2) that maximize must not fight | Confirm maximize still means "fill the viewport," and that exiting it returns to whichever mobile tab was active before |
| Browser window itself is resized while maximized | The canvas-mode path already handles container resize via `ResizeObserver` (Episode 15) — maximize must not introduce a second, conflicting resize-handling path | Reuse the existing `ResizeObserver`-driven resize logic unchanged; maximizing only changes the CONTAINER's CSS size/position, not how size changes are detected |

### Story 22.2 — Node-click detail popup anchored at the node's position (DOM/SVG mode)

As a user browsing a maximized (or normal) small-to-medium plan, I want clicking a node to show its details right next to that node, so I don't have to look away to a side panel that's easy to lose track of on a large diagram.

**Acceptance criteria**
- Clicking a node while in maximized mode opens a `DetailPanel` (same component, new `variant="popup"` — reusing Story 18.2's own established `variant` prop pattern, not a new content surface) positioned next to the clicked node's on-screen location, computed via React Flow's own `useReactFlow().flowToScreenPosition()` — no custom coordinate math needed in this mode.
- The popup clamps to stay fully within the viewport — flips to the opposite side of the node (left/right, above/below) when the default position would render it partially off-screen, the same way a well-behaved tooltip/dropdown library would; this is new logic this codebase doesn't have yet, and needs its own pure, unit-tested function (mirroring `viewportTransform.ts`'s own "framework-free, tested without a real DOM/canvas" pattern) rather than being computed inline in a component.
- The popup closes when: its own close button is clicked, Escape is pressed, or the user clicks a DIFFERENT node (which reopens the popup at the new node's position — not two popups at once). Panning/zooming does NOT close the popup — **confirmed with the user**: the popup live-repositions every frame to keep tracking the same node's on-screen position, via React Flow's `useViewport()` hook (subscribes the owning component to every pan/zoom tick) paired with `flowToScreenPosition()` re-evaluated on each resulting re-render — this is React Flow's own documented pattern for a screen-anchored overlay, not bespoke animation-loop code.
- Outside maximized mode, node clicks behave exactly as they do today (right-rail or overlay `DetailPanel`, unchanged) — this story's new popup behavior is scoped to maximized mode only, per Episode 22's own scope decision above.

**Testing approach**
- Unit tests for the new clamping/flip function: a node near each of the four viewport edges, and near a corner, produces a popup position that stays fully on-screen with the flip direction a human would actually expect (flip away from the edge it's near, not toward it).
- Component test: clicking a node in maximized mode opens the popup at a position derived from `flowToScreenPosition`'s mocked return value (React Flow's own testing convention for this — check how existing tests already mock/stub React Flow internals, e.g. `PlanGraph.test.tsx`'s own setup, rather than inventing a new mocking approach).
- Component test: clicking a second node while the popup is open closes the first and opens the second at the new position (never two simultaneous popups).
- Component test: panning/zooming (simulated via a `useViewport()` mock returning a changed transform) while the popup is open keeps it open and updates its rendered position to match the node's new `flowToScreenPosition()` value — never closes it.
- Regression test: outside maximized mode, the exact existing `PlanGraph.test.tsx` node-click-opens-detail-panel tests continue to pass completely unchanged — this story must not touch normal-mode behavior at all.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A node right at the very edge/corner of the viewport | The popup could render mostly or entirely off-screen with no clamping | Dedicated clamp/flip function, unit-tested at all four edges and both corners explicitly, not just the common "middle of the screen" case |
| A very long predicate/seek/join-condition value inside the popup (already a real case `DetailPanel`'s existing full-width-block rendering handles for the right-rail/overlay variants) | The popup is necessarily narrower than the right rail — the same long-text content could overflow or force an oversized popup | Popup gets its own max-width/scroll behavior, reusing `DetailPanel`'s existing long-text block styling rather than fighting it, but capped so it can't grow past a sane popup size the way the right rail is allowed to |
| Clicking a node whose collapsed ancestor was just expanded by the SAME click (a collapsed-group placeholder node) | This app's existing collapse/expand-on-click behavior (`PlanGraph.tsx`'s `expandCollapsedGroup`) must not also try to open a popup for a placeholder node that isn't a real operator | Reuse the existing `node.type === "collapsedGroup"` branch in `handleNodeClick` unchanged — a collapsed-group click never reaches the popup-opening code path, exactly as it never reaches the right-rail-opening one today |
| Keyboard activation (Enter/Space) of a focused node card, not a mouse click | This app's existing keyboard-access requirement (Story 6.2) for opening node details must keep working in maximized mode too | The popup opens from the SAME `onOpen` callback keyboard activation already triggers (`PlanNodeCard.tsx`) — positioned via that node's own screen coordinate the same way a mouse click's would be, not a keyboard-specific special case |

### Story 22.3 — Node-click detail popup anchored at the node's position (Canvas-rendering mode)

As a user browsing a maximized LARGE plan (the exact case this whole episode exists for — Episode 15's canvas-rendering threshold, 300+ nodes), I want clicking a node to show its details at that node's position, the same as a smaller plan, so the feature that motivated this episode actually works on the plans it was asked for.

Source note: this is its own story, not a sub-bullet of Story 22.2, on purpose — canvas mode has no per-node DOM element to ask for a screen position the way `flowToScreenPosition()` gives DOM/SVG mode one for free; it needs new coordinate math this codebase doesn't have yet, mirroring Episode 15's own precedent of treating canvas-mode as a dedicated story track alongside (not folded into) the DOM/SVG one.

**Acceptance criteria**
- `viewportTransform.ts` gains `worldToScreen(world, transform)` — the exact inverse of the existing `screenToWorld()` in the same file (`screen = world * transform.scale + {transform.x, transform.y}`), same framework-free/no-DOM/no-canvas testing style as its sibling functions.
- `CanvasPlanGraph.tsx`'s existing click-to-hit-test flow (`handlePointerUp`'s `findNodeAtPoint` call) additionally computes that node's on-screen popup anchor via the new `worldToScreen`, using the hit node's own world-space position/size (already available from `PlanGraphNode`, the same data `canvasDraw.ts` already draws from).
- The popup itself (component, clamping/flip logic, close conditions) is the SAME one Story 22.2 built — this story is entirely about FEEDING it a correct position in canvas mode, never a second popup implementation.
- Popup live-repositions during pan/drag or wheel-zoom, matching Story 22.2's own confirmed behavior — never closes on pan/zoom. Canvas mode already re-renders on every `handlePointerMove`/`handleWheel` tick because those handlers call `setTransform`; deriving the popup's screen position as `worldToScreen(hitNode.worldPosition, transform)` from that same state on every render keeps it tracking the node automatically, with no separate per-frame tracking loop needed.

**Testing approach**
- Unit tests for `worldToScreen`: round-trips with the existing `screenToWorld` (converting a point to world space and back returns the original point, within floating-point tolerance) — the cheapest, strongest correctness check for an inverse-function pair like this.
- Unit test: `worldToScreen` at a few explicit transform values (identity, panned, zoomed, panned+zoomed) against hand-computed expected coordinates — not just the round-trip property, which could pass even if BOTH functions had the same compensating bug.
- Component test (`CanvasPlanGraph.test.tsx`'s existing pattern, per `hitTest.test.ts`'s own precedent of testing canvas interaction without a real canvas): clicking a synthetic node at a known world position, with a known transform, opens the popup at the expected screen coordinate.
- Component test: after opening the popup, changing `transform` (simulating a pan or zoom tick) and re-rendering moves the popup to the new `worldToScreen`-derived position, matching the node's new screen location — never closes it.
- e2e test on a real large (300+-node) fixture, reusing `e2e/canvas-large-plan.spec.ts`'s established real-browser pixel-painting verification pattern: click a node, confirm a popup actually renders at a position near that node on screen (not just that SOME popup opened somewhere); then pan/zoom and confirm the popup visibly follows rather than disappearing.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A node inside a currently-collapsed group (canvas mode's own collapsed-group placeholder, distinct from the DOM/SVG mode's) | Clicking a collapsed-group placeholder in canvas mode already expands it (`CanvasPlanGraph.tsx`'s own `onExpandCollapsedGroup`) — this must keep working, never accidentally opening a popup FOR the placeholder itself | Reuse the existing `hit.data.kind === "collapsed-group"` branch unchanged, exactly as Story 22.2 reuses the DOM/SVG mode's equivalent |
| `worldToScreen`'s own numeric edge cases (extreme zoom levels — `MIN_SCALE`/`MAX_SCALE` already defined in this file — or a node at world-space coordinates far from the origin on a very large plan) | A popup position computed from a degenerate transform could render at nonsensical (NaN, absurdly large) screen coordinates | Same defensive-numeric discipline this codebase applies everywhere else (rule-engine-authoring skill's own numeric-edge-case checklist) — clamp/guard rather than let a bad number reach the DOM as an inline style |
| The accessible-list fallback (`AccessiblePlanList.tsx`, Episode 15 Story 15.2) — keyboard/screen-reader users of canvas mode use this instead of the canvas surface directly | The accessible list already opens the SAME right-rail/overlay `DetailPanel` via `onSelectNode` — it has no "node position" to anchor a popup to at all, and shouldn't need one (it's a linear list, not a spatial diagram) | The accessible list's own node-selection path is explicitly UNCHANGED by this episode — the node-anchored popup is a spatial-diagram-specific affordance, not something the accessible list needs or should try to replicate |

## Episode 23 — Query Health Score

Source: user idea — a single deterministic, explainable score ("Query Health: 67/100") plus five per-dimension subscores (Runtime, I/O, Cardinality, Memory, Parallelism), explicitly requested as **not** LLM-generated. Discussed with the user before speccing: the idea is good and fits this app's architecture (pure math over already-computed `Warning[]` data, zero new network-call/privacy-architecture surface — see `.claude/skills/privacy-architecture/SKILL.md`), but collides with a principle already load-bearing elsewhere in this codebase: `rule-engine-authoring`'s own parameter-sensitivity honesty rule exists specifically because *"a single pasted plan is one snapshot of one execution... [rules must not produce] a false-confidence diagnosis."* A single clean number is exactly the kind of confident-sounding output that principle warns against, amplified because it's the ONE thing a user is most likely to screenshot and treat as ground truth. This episode's design is built around that tension from the start, not retrofitted after: **a dimension that doesn't have enough data to score honestly does not render a fabricated number — it says so, the same "honest gap state, never a fabricated value" discipline `buildStatRows.ts` already applies to every other field in this app.**

**Cross-engine coverage, checked and updated after the initial draft**: this app supports Postgres, SQL Server, and Snowflake equally everywhere else, so the score had to be checked against all three, not designed Postgres-first and left there. Four of the five dimensions (Runtime, Cardinality, Memory, I/O) already score on all three engines with zero new work, verified directly against each engine's `operatorMap.ts`/rule files rather than assumed — see the dimension table below. Parallelism needed real new work to reach SQL Server (Story 23.2, extended below) and hits a genuine, checked data-source ceiling on Snowflake, which is disclosed as a permanent design decision rather than quietly left as a TODO.

### Dimension → rule-family mapping (the actual scoring model)

Checked against the real rule set (`src/rules/index.ts`, `ALL_RULES` — 10 registered rules; `parameter-sensitivity-honesty-note` and `estimate-only-plan` are disclosure notes about the plan's own nature, not defects, and are excluded from scoring entirely, never penalized):

| Dimension | Rule families (`ruleFamily()`, `summarize.ts`) | Renders a real number only when... |
|---|---|---|
| Runtime | `seq-scan-on-large-table`, `high-loop-count` | `context.hasActualData` is true. **Scores on all three engines**, verified against each engine's own `operatorMap.ts`: Snowflake's `TableScan` and SQL Server's `Table Scan` both already normalize to the same `operatorType: "seq_scan"` `seq-scan-on-large-table` matches on — checked directly, not assumed. `high-loop-count` is effectively Postgres/SQL-Server-only in practice (Snowflake's operator tree has no loop/re-execution concept at all, per `docs/10-node-stats-field-catalog.md` §7 — the field is simply always `undefined` there, so this rule family silently never contributes on Snowflake, same "no data, no claim" degradation every rule already has, not a special case to build) |
| Cardinality | `bad-row-estimate`, `exploding-join`, `missing-index-opportunity`, `non-sargable-predicate` | at least one node has `estimatedRows !== undefined` — the family this dimension is named for is fundamentally about estimate quality/join fan-out, which the structural rules (`missing-index-opportunity`, `non-sargable-predicate`) can judge even estimate-only. Engine-agnostic by construction (normalized fields, no per-engine branching in any of the four rule files) |
| Memory | `disk-spill` | at least one node has `node.spill !== undefined` — the parser attempted spill detection for it (see `SpillInfo`, `normalize.ts`) regardless of whether it actually spilled. Already engine-agnostic (`diskSpill.ts` reads the normalized `spill` field, populated by all three parsers per the field catalog's §6) |
| I/O | `buffer-cache-inefficiency` | at least one node has `io.bufferHits`/`io.bufferReads` (Postgres w/ `BUFFERS`, SQL Server logical/physical reads) OR (Snowflake) a populated `timeBreakdown` disk-I/O share — `bufferCacheInefficiency.ts` already branches per `node.engine` internally for exactly this reason; **scores on all three engines** today, no new work needed |
| Parallelism | `parallel-worker-shortfall` (**Story 23.2**, extended this update to cover Postgres + SQL Server — see that story) | Postgres: at least one node has both `parallel.workersPlanned` and `parallel.workersLaunched` defined (`extendedFields.ts`, already true today). SQL Server: `context.hasActualData` is true AND `context.compiledDegreeOfParallelism !== undefined` (a new context field Story 23.2 adds, from the query-level `DegreeOfParallelism` XML attribute real SQL Server plans already carry — confirmed present in this repo's own `real-world-large-parallel-estimated.xml` fixture, currently parsed but never read). **Snowflake stays "insufficient data" — a deliberate, checked, permanent ceiling, not a gap left to close**: `GET_QUERY_OPERATOR_STATS()` exposes no per-node or per-query worker/thread/parallelism concept at all (confirmed against `docs/10-node-stats-field-catalog.md` and `src/parsers/snowflake/buildTree.ts` — the closest adjacent field, `partitionsScanned`/`partitionsTotal`, is a pruning/I/O concept already covered by the I/O dimension, not parallelism). Building a Snowflake Parallelism score would mean inventing a number this data source cannot support — exactly what this whole episode's design exists to refuse |

This mapping, the penalty numbers below, and the eligibility gates are the actual spec — a future story retuning any of them should update this table, not silently drift from it (`STORY_TEMPLATE.md` rule 4).

### Story 23.1 — Deterministic per-dimension + overall health scoring engine

As an experienced user doing a quick sanity check (Persona C) or a stuck junior developer wanting an at-a-glance verdict (Persona A), I want a single trustworthy score with a clear breakdown, so I know how worried to be about this plan without reading every finding myself — and so I can trust the number precisely because it's computed the same, explainable way every time, not generated fresh per request.

**Acceptance criteria**
- A new pure function (mirrors `summarize.ts`'s own "pure function over `PlanNode`/`PlanContext`, no React, framework-free" shape), e.g. `computeQueryHealth(root: PlanNode, context: PlanContext): QueryHealth`, in a new `src/rules/queryHealth.ts`.
- Per-dimension scoring: start at 100; for each rule family mapped to that dimension (table above), find the WORST-severity instance anywhere in the tree (reusing `dedupeByFamily`'s exact worst-instance-per-family logic already in `summarize.ts` — exported/shared, not reimplemented a second time) and subtract a fixed penalty: critical = −30, warning = −12, info = 0 (an info-severity finding — the two honesty notes aside, no defect rule currently emits `info` — never penalizes). Multiple different families in the same dimension both apply their own penalty, summed; floored at 0. **These exact numbers are a first defensible default, deliberately simple, not derived from calibration against a corpus of real plans** — flagged explicitly as a number to revisit once real usage exists, the same honesty this codebase already applies to `CANVAS_NODE_COUNT_THRESHOLD`'s own "not yet benchmarked" note (`PlanGraph.tsx`) — don't let a future reader mistake "shipped" for "proven correct."
- A dimension whose eligibility gate (table above) isn't met returns `{ status: "insufficient-data" }` instead of a number — never 0, never 100, never omitted from the returned shape (the UI in Story 23.3 needs to know it was CONSIDERED and found ungradable, not silently missing).
- Overall score = the unweighted (equal-weight, explicitly — see feasibility note on why arbitrary weighting is itself a trust risk) average of whichever dimensions DID score, rounded to the nearest integer. If zero dimensions scored, `computeQueryHealth` returns `{ status: "insufficient-data" }` at the top level too — this is expected to be rare (every currently-supported engine scores at least Cardinality or I/O in practice) but must degrade gracefully, not divide by zero.
- Severity counts (the 🔴/🟠/🟢 legend): node-scoped, not finding-scoped — 🔴 = count of distinct nodes carrying at least one `critical`-severity warning; 🟠 = count of distinct nodes carrying at least one `warning`-severity warning AND no critical one (a node already counted red isn't double-counted amber); 🟢 = count of nodes carrying zero warnings at all. `red + amber + green` always equals `context.nodeCount` exactly — a property worth asserting directly in tests, not just eyeballing example numbers.
- `applyRules` (or a caller downstream of it, e.g. `analyzePlan.ts`) must have already run before `computeQueryHealth` is called — this function reads `node.warnings`, it does not run rules itself. Document this ordering dependency in the function's own doc comment, matching how `buildPlanContext`'s own doc comment states its inputs.

**Testing approach**
- Unit tests, one per dimension: a fixture that SHOULD score low (a specific rule family firing at critical), a fixture that scores 100 clean, and a fixture that hits the eligibility gate and returns `insufficient-data` — the same two-way-plus-gate pattern `rule-engine-authoring`'s own testing checklist already requires per rule, applied one level up.
- A snapshot-style test asserting the EXACT penalty math for a hand-built plan with two different critical findings in the same dimension (100 − 30 − 30 = 40), not just "the score went down."
- A test with a Snowflake fixture confirming Parallelism comes back `insufficient-data` (the one permanent, checked cross-engine gap this episode has) while Runtime (via `seq-scan-on-large-table` matching Snowflake's `TableScan` → `seq_scan`), Cardinality, Memory, and I/O (via `timeBreakdown`) all still score — this is the dimension table's own central claim, worth locking in with a real fixture, not just asserted in prose. A separate SQL Server fixture confirms Parallelism DOES score there once Story 23.2 lands (`compiledDegreeOfParallelism` present, real thread-count data available).
- A test confirming `red + amber + green === context.nodeCount` on a plan with a realistic mix of severities.
- A test confirming zero rules firing anywhere still returns `100` for every eligible dimension (not `undefined`/`NaN`) — the "everything's fine" case is as important to get right as the "everything's broken" one.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan with only `info`-severity findings (the two honesty notes) and nothing else | These aren't defects — a naive implementation might accidentally penalize them since they ARE `Warning[]` entries | Explicitly excluded by rule id before scoring starts (table above), not by relying on their `info` severity happening to map to a 0 penalty — an `info`-severity DEFECT rule added later must still count |
| A single rule family firing on many different nodes (e.g. `seq-scan-on-large-table` on 40 different tables in one huge plan) | Per-instance penalties would let one dimension collapse to 0 disproportionately on a large plan vs. a small one with the identical single issue | Worst-instance-per-family dedup (same as `summarize.ts`'s own top-level verdict) — one penalty per family, regardless of how many nodes it fired on |
| A multi-statement batch | Story 20.1–20.5 already established that plan-wide vs. per-statement facts need explicit handling — a score computed on the wrong basis silently repeats or drifts across tabs the way the header notices bug (Story 20.5) did | `computeQueryHealth` takes ONE statement's root/context, same as `summarizePlan` already does — scored per-statement, called fresh on every `switchToStatement`, never cached across statements |
| Zero nodes eligible for ANY dimension (a pathological or synthetic plan) | Must not throw, divide by zero, or silently show a misleading `0/100` | Top-level `insufficient-data`, per the AC above — explicit test |

### Story 23.2 — `parallel-worker-shortfall` rule (Postgres + SQL Server)

As a polyglot backend/data engineer (Persona B) working across all three engines in the same week, I want to know when a query asked for parallel execution but didn't get it, on whichever engine I'm looking at — not just Postgres — so I can tell "this ran serially because of a real resource shortfall" apart from "this ran serially because it never asked," a distinction the raw worker/thread numbers already in the detail panel don't currently call out as a *problem* on either engine.

**Extended from the original Postgres-only draft** after checking real fixtures: `real-world-large-parallel-estimated.xml` already carries a query-level `DegreeOfParallelism="16"` attribute this codebase parses past but never reads — SQL Server *does* expose a "planned" parallelism concept, it's just query-level (decided once at compile time) rather than per-node the way Postgres's `Workers Planned` is. **Snowflake genuinely has no such signal at any level** — see the dimension table's own note above; this story does not touch Snowflake, and that's a checked, permanent conclusion, not an oversight.

**Acceptance criteria**
- New `src/rules/parallelWorkerShortfall.ts`, registered in `ALL_RULES` (`src/rules/index.ts`) and `RULE_FAMILY_CATEGORY` (`findingCategory.ts`, new `"Parallelism issues"` category — or fold into an existing category if a reviewer prefers; state the choice explicitly rather than defaulting silently into `"General notes"`).
- A shared, pure severity-scaling helper — e.g. `parallelShortfallSeverity(planned: number, launched: number)` — used by BOTH engine paths below, not two independently-drifting copies of the same threshold: `warning` when launched ≥ half of planned, `critical` when launched is 0 or under half.
- **Postgres path** (per-node, unchanged from the original draft): fires on any node where `node.parallel?.workersPlanned !== undefined && node.parallel?.workersLaunched !== undefined && node.parallel.workersLaunched < node.parallel.workersPlanned`.
- **SQL Server path** (query-level — new): requires two new fields, added the same way Postgres's `Planning Time` is captured (root-node-only, not per-node):
  - `ParallelInfo` (`normalize.ts`) gains `compiledDegreeOfParallelism?: number` and `nonParallelPlanReason?: string`, populated ONLY on the root node by `parseShowplanXml.ts`, reading the `QueryPlan` element's `DegreeOfParallelism`/`NonParallelPlanReason` attributes (both currently unread — add to `docs/10-node-stats-field-catalog.md` per `STORY_TEMPLATE.md` rule 5, this episode doc doesn't own that content).
  - `PlanContext` (`rules/types.ts`) gains `compiledDegreeOfParallelism?: number`, surfaced from `root.parallel?.compiledDegreeOfParallelism` in `buildPlanContext` — the exact same "root field → context field" pattern `totalEstimatedCost`/`totalActualTimeMs` already use, not a new pattern.
  - The rule itself: `if (node.id !== context.rootId) return []` (the exact established pattern `parameterSensitivityNote.ts`/`estimateOnlyNote.ts` already use for whole-plan-level facts) — then requires `context.hasActualData` (real per-node thread-count data must exist; see edge case below for why) AND `context.compiledDegreeOfParallelism !== undefined && context.compiledDegreeOfParallelism > 1`. Computes `maxObservedThreads = Math.max(0, ...collectNodes(root).map(n => n.parallel?.workersLaunched ?? 0))` and fires (via the shared severity helper) when `maxObservedThreads < context.compiledDegreeOfParallelism`.
- `nonParallelPlanReason`, when present on a finding that already fired via the DOP-shortfall comparison above, is appended to `longText` as real, concrete context ("SQL Server recorded the reason: ..."). **It does NOT independently trigger the rule** — deliberately: this app has no verified, complete enumeration of every `NonParallelPlanReason` string SQL Server can emit, and some (e.g. an explicit `MAXDOP` hint/setting) describe a deliberate configuration choice, not a problem. Treating an unclassified reason string as a trigger risks the exact false-positive-erodes-trust failure mode `rule-engine-authoring` warns about; using it only as enrichment on an ALREADY-detected numeric shortfall avoids needing that classification at all.
- `shortText`/`longText` name the concrete numbers on whichever engine fired ("planned 4 workers, launched 1" / "compiled for DOP 16, observed 4 threads") and the general, non-overclaiming real-world cause (resource contention at execution time) — never a diagnosis this single plan can't actually confirm, same honesty as the original draft.

**Testing approach**
- Postgres: unchanged from the original draft — critical-grade fixture, warning-grade boundary fixture, `workersPlanned === workersLaunched` negative fixture, neither-field-present negative fixture.
- SQL Server: a fixture with `DegreeOfParallelism > 1` and real per-node thread counts below it (critical-grade and warning-grade boundary, mirroring the Postgres pair) — extend `real-world-large-parallel-estimated.xml` or add a dedicated new fixture.
- SQL Server negative fixture: `DegreeOfParallelism="1"` (never intended to be parallel) — must not fire.
- SQL Server negative fixture: `DegreeOfParallelism` present and greater than 1, but the plan is estimate-only (`hasActualData` false, no `RunTimeCountersPerThread` anywhere) — must NOT fire (see edge case below; this is the one genuinely easy-to-get-wrong case in this story).
- A fixture with a `NonParallelPlanReason` string present alongside a real firing shortfall — asserts the reason text appears in `longText`, and a SEPARATE fixture with the reason string present but DOP ≤ 1 (no shortfall) — asserts NO finding, locking in "enrichment only, never an independent trigger."
- End-to-end tests through `analyzePlanText` on real fixtures for both engines, per this session's established precedent (`postgresRuleTriggerScenarios.test.ts`) — not just the rule function in isolation.

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| `workersLaunched > workersPlanned` (Postgres) | Shouldn't happen per Postgres's own semantics, but not provably impossible across every version | Explicit fixture, asserts no finding |
| SQL Server estimate-only plan with `DegreeOfParallelism > 1` but no real thread-count data anywhere | Without the `hasActualData` gate, `maxObservedThreads` computes as `0` for every node (the field is simply never populated), making EVERY compiled-parallel estimate-only SQL Server plan look like a total shortfall — a serious, systematic false positive, not a rare edge case | Explicit `context.hasActualData` gate before the comparison runs at all — dedicated negative fixture, this is the story's single highest-risk mistake to get right |
| `DegreeOfParallelism="1"` (SQL Server plan never intended to be parallel) | The overwhelming common case for most real SQL Server queries — must never fire | `> 1` check before any comparison, explicit negative fixture |
| A `NonParallelPlanReason` string SQL Server emits for a deliberate config choice (e.g. an explicit `MAXDOP` setting), not a real problem | Firing (or implying a problem) off an unclassified reason string this codebase can't verify the full meaning of is a real false-positive risk | Reason string is enrichment-only on an already-numerically-detected shortfall, never an independent trigger — see AC above |
| Snowflake nodes reaching this rule at all | Must not throw or misbehave just because it's never meant to fire there | Both engine paths already gate on fields Snowflake never populates (`node.parallel` is always `undefined` there) — falls through to no finding by construction, same as every other engine-scoped rule in this codebase; add a Snowflake fixture asserting no finding anyway, since "by construction" claims are exactly what a regression test should verify rather than trust |
| A node whose parallelism is entirely healthy sitting alongside a sibling (Postgres) with a real shortfall | Dedup/family logic (Story 23.1) already handles "worst instance wins" for scoring, but the FINDING itself must still be attributed to the right specific node, not the plan root | Standard per-node rule shape for the Postgres path — no special-casing needed beyond what every other node-level rule already does |

### Story 23.3 — "Query Health" card

As a stuck junior developer (Persona A), I want to see one number and a short breakdown the moment a plan loads, so I know how worried to be before I dig into any individual finding.

**Acceptance criteria**
- New `QueryHealthCard` component (`src/graph/queryHealth/` or similar, following this codebase's existing directory-per-concern convention — e.g. `src/graph/findings/`, `src/graph/detailPanel/`), rendered in `PlanReaderPage.tsx` near the existing plan-shell summary sentence (`plan-shell__summary`, Story 5.2) — additive, not a replacement: the qualitative sentence and the quantitative score are two different, complementary views of the same underlying findings, and this story does not touch `summarize.ts` or its existing callers/tests.
- Shows the overall score (or, when `insufficient-data`, an explicit "Not enough data to score this plan" state — never a placeholder number, never a hidden/blank card that reads as broken) and the 🔴/🟠/🟢 node counts from Story 23.1.
- An expandable breakdown (collapsed by default, matching this app's own established "collapsed-by-default" density convention — `FindingsList`, `RecentPlansList`) shows the 5 per-dimension bars/numbers; a dimension in `insufficient-data` state renders visibly distinct from a real low score (e.g. greyed out with "not enough data" — a 20/100 and "ungraded" must never look the same at a glance, since they mean opposite things: one is a real problem, the other is an honest absence of signal).
- A visible, always-reachable explanation of the scoring method (an info icon/tooltip or an inline "How this is calculated" disclosure) states the exact mechanism in plain terms: rule-based, deterministic, penalty-per-issue-family, equal-weighted average — the "not LLM-generated, and here's what it actually does" disclosure this whole episode's design turns on, not an afterthought.
- Recomputes on every `switchToStatement` (Story 23.1's own per-statement scoping) — verified the same way Story 20.5 verified the header notices DON'T incorrectly persist/repeat across tabs, applied here in the opposite direction (this SHOULD change per statement, unlike those plan-wide notices).
- Beginner/Expert-agnostic: the score itself doesn't change with the toggle (it's not narration, it's a number), but the breakdown's per-family explanation text can reuse `Warning.shortText`/`longText` per the existing convention if the card links out to specific findings.

**Testing approach**
- Component test: a fixture with a known, hand-computed expected score renders that exact number and the correct 🔴/🟠/🟢 counts.
- Component test: a Snowflake (or estimate-only) fixture renders the Runtime/Parallelism dimensions as visibly "not enough data," distinctly styled from a real low number — assert on a `data-testid`/class distinction, not just text content, so a future refactor can't accidentally make them look identical.
- Component test: switching statement tabs (multi-statement fixture) recomputes and re-renders a different score — regression-guards the per-statement scoping from Story 23.1.
- Component test: the "how this is calculated" disclosure is reachable and its content matches the actual formula (penalty values, equal-weight average) — a docs-vs-code drift test, not just "the button exists."
- Mobile-width test (this app's own standing requirement, per the `graph-visualization` skill, for every layout-affecting story).

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| A plan where every dimension is `insufficient-data` (Story 23.1's own top-level degenerate case) | The card must not render a broken-looking blank state or a misleading score | Explicit "not enough data to score this plan" card state, styled the same way this app's other honest-gap states already are (e.g. the estimate-only-plan notice) |
| A 300+-node canvas-mode plan | This card lives in the app shell, not inside `PlanGraph`/`CanvasPlanGraph` — must render identically regardless of which rendering mode the graph itself is using | Card reads only from `PlanContext`/the statement's root `PlanNode` tree, already available in `PlanReaderPage.tsx` regardless of `useCanvas` — no new dependency on graph internals |
| Maximized mode (Episode 22) | A new always-visible card could collide with the maximized pane's own toolbar the same way Story 22.1 found for the search/maximize toolbar | **Decided**: scoped to normal (non-maximized) mode only — `PlanReaderPage.tsx` renders `<QueryHealthCard>` gated on `!isMaximized`, live-verified in a real browser (hidden while maximized, reappears with the exact same score on restore). Maximized mode's toolbar already has 5 elements competing for the same space (Story 22.1); this card's own value (an at-a-glance verdict on load) is a normal-mode, first-look concern, not something a user already maximized to explore a large plan is reaching for |
| A user with the card expanded, then switching to a statement that's `insufficient-data` at the top level | Expand/collapse state (local UI state) shouldn't itself throw or show stale per-dimension numbers from the PREVIOUS statement for a frame | Breakdown content is derived fresh from the current statement's `computeQueryHealth` result on every render, never held in state separately from it |

## Episode 24 — Postgres Advanced Rules

Source: user request — 12 new Postgres-specific findings ("PG-*" prefixed by the user, kept here without the prefix per this repo's own existing `ruleId` convention — every other rule id, e.g. `bad-row-estimate`, is unprefixed kebab-case) moving from node-level symptoms toward genuine PostgreSQL performance reasoning: heap fetches, filter/join-filter row discards, Hash/Sort memory spill internals, temp I/O, planning/JIT overhead, Materialize/Memoize re-scan effectiveness, partition fan-out, and WAL volume. Every field checked against real Postgres `EXPLAIN` JSON key names before any rule was written (several already existed in this repo's own fixtures, e.g. `Hash Batches`/`Sort Space Type` from Episode 5's disk-spill rule) — see `docs/10-node-stats-field-catalog.md` §10 for the full field-by-field source table, including two honestly-disclosed TEXT-format gaps (Memoize cache stats, the JIT block) left JSON-only rather than shipped with an unverified multi-line regex.

**Cross-cutting decisions applied to every story below**, not repeated per-row: every rule suppresses trivial/small cases via an explicit volume and/or materiality floor (never fires on symptom-shaped-but-tiny data); every rule that could have one cause names multiple honestly rather than diagnosing a single root cause the plan can't actually confirm; `docs/10-node-stats-field-catalog.md` §10 (not this table) is the source of truth for exact JSON/TEXT key names; `queryHealth.ts`'s `DIMENSION_RULE_FAMILIES` was extended so all 12 new rule families actually feed Episode 23's Query Health score rather than being silently invisible to it. Full design reasoning lives in each rule file's own doc comment (`src/rules/*.ts`) — this table cross-references rather than duplicates it (`STORY_TEMPLATE.md` rule 4's own principle, applied to already-completed work).

| Story | `ruleId`(s) | Mechanism | Key decision |
|---|---|---|---|
| 24.1 — Excessive heap fetches | `index-only-heap-fetches` | Index Only Scan's `heapFetches`/`actualRows` ratio, gated on a row-volume floor | Never claims VACUUM is definitely required — the real causes (visibility-map coverage, VACUUM state, recent writes) aren't distinguishable from one pasted plan; recommends investigating, not a fix |
| 24.2 — Rows Removed by Filter | `filter-rows-discarded` | Selectivity ratio (removed/(removed+returned)), loop-multiplied volume floor, AND an execution-time floor (the story's own "healthy" example has real discard but trivial runtime) | Avoids blanket index advice — states the symptom, references the existing missing-index/non-sargable rules for WHY, doesn't assume |
| 24.3 — Rows Removed by Join Filter | `join-filter-rows-discarded` | Same ratio/volume shape as 24.2, scoped to join operators specifically (new `rowsRemovedByJoinFilter` field, distinct from a scan's own filter) | Never diagnoses one cause — longText names all four possibilities (condition, ordering, cardinality error, genuine breadth) every time |
| 24.4 — Hash batching | `hash-batching` | `Batches > 1` + a row-volume floor; severity scales with batch count | Deliberately kept separate from the generic `disk-spill` rule (both can and often do fire together on the same Hash node) rather than merged, per the story's own instruction |
| 24.5 — Sort Method intelligence | `sort-disk` / `sort-large` | Classifies `Sort Method`; only `spaceType === "disk"` above a materiality floor fires, severity split by volume (100 MB) into two distinct rule ids | Normal in-memory methods (quicksort/heapsort/top-N heapsort/incremental) never warn — confirmed with a dedicated negative test per method |
| 24.6 — Temporary I/O | `temp-io` | `Temp Read/Written Blocks` × Postgres's fixed 8 kB block size, above a block-count floor | Explicitly relates itself in wording to a co-occurring Sort/Hash spill finding on the SAME node rather than presenting temp I/O as an unrelated mystery, per the story's own instruction |
| 24.7 — Planning time dominates execution | `planning-overhead` | Root-only; needs BOTH an absolute floor (50 ms) AND planning ≥ execution — the absolute floor is what correctly suppresses the story's own trivial 0.3 ms/0.05 ms example, since ratio alone (6x) would not | New root-only `planningTimeMs`/`executionTimeMs` fields (`normalize.ts`) — promoted from raw, previously-unparsed strings in both JSON and TEXT parsers |
| 24.8 — JIT overhead | `jit-overhead` | Root-only; JIT `totalMs`/execution-time ratio above 20%, with its own absolute floor | Never states JIT should be disabled — frames the overhead as a compile-cost-vs-amortization tradeoff this single run can't resolve either way |
| 24.9 — Materialize re-scan cost | `materialize-repeated` | Fires only when loops, cached-row-volume, AND total runtime contribution are ALL above their own floors together (not any one alone) | Explicitly states Materialize is not inherently bad in every instance of the finding text, not just the story's own instruction to me |
| 24.10 — Memoize effectiveness | `memoize-low-hit-rate` / `memoize-evictions` | Two independent checks off the same node — hit-rate ratio (with a lookup-volume floor) and eviction ratio — can both fire together | Never warns just because Memoize exists — the volume floor is the same "don't warn on too little data to judge" principle Episode 23's own eligibility gates use |
| 24.11 — Partition pruning effectiveness | `partition-fanout` | Fires ONLY when `Subplans Removed` evidence is ABSENT and fan-out is large — when the evidence IS present, this rule stays silent (nothing to flag either way) | Never claims poor pruning without evidence — real evidence closes the question entirely rather than being compared against a threshold |
| 24.12 — WAL-heavy plan | `wal-volume` | Per-node (whichever write operator generated it); fires above a byte-volume floor | `info` severity only — kept observational, since whether WAL volume actually matters depends on replication/archiving context this app can't see |
| 24.13 — Comprehensive test coverage | — | 72 rule-level unit tests (positive/negative/edge-case per rule, matching every story's own worked example) + 12 new real-fixture end-to-end tests through the actual parse → rule-engine pipeline (`postgresRuleTriggerScenarios.test.ts`), reusing 2 existing Episode 5 fixtures where they already satisfied a new rule's trigger condition | Found and fixed 2 real bugs this sweep exists to catch: an invalid fixture Node Type (`Modify Table`, not `Insert`/`ModifyTable`) and an operator-icon "accepted unmapped" list needing Materialize/Memoize added (a pre-existing, already-documented design decision, not a new gap) |

**TEXT-format parity**: every field above works through BOTH the JSON and TEXT parsers except Memoize's cache stats and the JIT block (JSON-only, honestly disclosed — see field catalog §10). Three fields needed dedicated combined-line regexes in `textParser.ts` (Sort Method+space, Hash Buckets+Batches+Memory, WAL's own `key=value` line shape) since Postgres's real plain-EXPLAIN output packs them onto one line each, which the existing generic single-`Key: Value`-per-line mechanism can't parse correctly — locked in with dedicated parser tests (`extendedFields.test.ts`), not just JSON coverage.

## Episode 25 — Postgres Cross-Node Reasoning

Source: user request, 7 stories. Scoped to Postgres only — clarified with the user before writing this spec, since the request's own closing line ("Make SQL Server one of PlanReader's strongest engines") contradicted every story's actual content (all seven extend Postgres-specific rules: `bad-row-estimate`, `exploding-join`/`high-loop-count`, `parallel-worker-shortfall`). The user confirmed Postgres-only for this episode; a SQL Server richer-Showplan episode is a separate, not-yet-specced follow-up if wanted.

Where Episode 24 moved from node-level symptoms toward single-node Postgres reasoning, Episode 25 moves from single-node findings toward **cross-node** reasoning: a bad estimate at a leaf scan that visibly propagates into a join explosion three levels up is one story, not three unrelated warnings.

**Cross-cutting architectural decision — new, applies to 25.1 and 25.7 only**: the `Rule` type (`(node, context) => Warning[]`) stays exactly as-is. A single rule function only ever sees one node plus whole-tree scalars (`PlanContext`) — it has no way to reference another node's findings, and this episode does not change that contract (no rule gets a "list of all findings so far" argument; that would make rule output order-dependent, breaking the "independently unit-testable, deterministic" guarantee `rule-engine-authoring` requires). Instead, propagation/grouping is a **second pass that runs after** `collectAllFindings` produces its normal per-node `Warning[]`, exactly the same shape `summarize.ts`'s own `buildAncestryIndex`/`areRelated`/`isScanToDownstreamPair` already use for its 2-finding case (Episode 5, Story 5.2) — this episode generalizes that existing, already-shipped mechanism from "top 2 findings, one hardcoded scan→downstream pair" to "every finding, any number of hops, multiple related-family pairs" rather than inventing a second, differently-shaped relationship system. New module `src/rules/cardinalityPropagation.ts` exports `linkPropagatedFindings(root): FindingRelationship[]`, where `FindingRelationship = { causeNodeId, causeFamily, effectNodeId, effectFamily, hops }` — additive metadata alongside `Finding[]`, never mutating `Warning` itself (a `Warning`'s own text stays authored once, per-node, exactly as today; the relationship is a separate lookup a UI can join against it). `causedBy`/`contributesTo` are the two directions of the same edge list, not two independently-computed relations that could drift out of sync.

**Which family-pairs count as propagation** (not any two co-occurring findings on an ancestor chain — that would over-connect a plan with many unrelated issues into one false narrative): `bad-row-estimate` at a descendant → `exploding-join` / `high-loop-count` / `nested-loop-explosion` (25.2) at an ancestor, walked via the existing `children`-only tree (no new parent pointer needed — `buildAncestryIndex` already computes ancestor sets top-down from `root.children`). A chain of 3+ (scan → nested loop → aggregate, the story's own example) links transitively: the scan's bad estimate is `causedBy`-free (it's the root cause) and `contributesTo` both the nested loop AND the aggregate; the nested loop is `causedBy` the scan and `contributesTo` the aggregate. This reuses `dedupeByFamily`'s worst-instance-per-family logic so a family appearing on multiple nodes in the chain still produces one clean edge, not a combinatorial explosion of links.

| Story | `ruleId`(s) / module | Mechanism | Key decision |
|---|---|---|---|
| 25.1 — Cardinality error propagation | `cardinalityPropagation.ts` (`linkPropagatedFindings`) — no new `ruleId`, this is metadata ON existing findings, not a new finding | Ancestor-chain walk linking `bad-row-estimate` findings to downstream `exploding-join`/`high-loop-count`/`nested-loop-explosion` findings on the same lineage | Never asserts the estimate error CAUSED the downstream symptom with certainty PlanReader can't have from one plan — phrased as "likely propagation" in any consuming UI text, matching this rule's own honesty precedent (`bad-row-estimate.longText` already says estimate errors "often cascade," not "will cascade") |
| 25.2 — Nested loop explosion | `nested-loop-explosion` | Postgres-specific, `nested_loop_join` only (unlike the engine-agnostic `high-loop-count`, which reads generic `loops`/`actualTimeMs`): outer child's `actualRows`, inner child's `loops`, AND inner child's cumulative actual time (`loops × actualTimeMs`) must ALL clear their own floor together — outer-rows floor, loops floor, AND a cumulative-inner-work-ms floor, the same "every factor together, not any one alone" shape `materialize-repeated` (24.9) already established | The story's own healthy case (outer 5, loops 5, runtime 0.4ms) must not fire — verified by the cumulative-work floor alone already excluding it (5 × 0.4ms = 2ms), independent of the row-count floor, so a future threshold tweak to one factor can't accidentally make the other the only thing preventing a false positive |
| 25.3 — Repeated inner scan | Extends `nested-loop-explosion`'s longText (25.2) with an approximate total-repeated-work figure — no new `ruleId`; a genuinely separate rule would just be describing the same node's join partner a second time under a different name | `loops(join) × inner child's own per-loop actualTimeMs` — reuses the exact multiplication `high-loop-count` already performs for its own "~Nms total" figure (`highLoopCount.ts`), not a second independently-computed estimate | Explicitly labeled "approximate" in the generated text (per-loop time averages across loops that may not be uniform) — never presented as a measured total, since Postgres doesn't report one directly |
| 25.4 — Estimate error materiality | Reworks `bad-row-estimate`'s existing severity assignment (currently binary: ratio ≥10x/≤0.1x fires, always `warning`) into a materiality score combining ratio, absolute row difference (a floor — the story's own "est 1 → actual 50" example is a 50x ratio but only 49 rows, correctly non-material), the node's own share of total plan runtime (`actualTimeMs` / `context.totalActualTimeMs`, only when `hasActualData`), and whether the node feeds a join (checked via its parent, since `PlanNode` has no parent pointer — `cardinalityPropagation.ts`'s own ancestry index, built once and reused here rather than a second tree walk) | `computeMismatchFactor` (existing, exported, already reused by the graph's own mismatch badge) is NOT changed — the ratio number shown on the badge stays exactly what it is today; only `bad-row-estimate`'s OWN severity assignment inside the rule gains the extra materiality factors, so nothing else that reads `computeMismatchFactor` is affected |
| 25.5 — Potential statistics investigation | Text-only change to `bad-row-estimate.longText` | Replaces "Stale table statistics are the most common cause." with an investigate-list naming statistics freshness, column correlation, extended statistics, predicates, and parameter values — none stated as confirmed | Direct instruction from the story: never state "Your statistics are stale" as a fact this app can't verify from one plan |
| 25.6 — Parallel worker effectiveness | Extends `parallel-worker-shortfall` (Postgres path only — SQL Server's query-level check, 23.2, is unchanged) | Three additions, each gated on data this codebase's parser actually populates today, checked before writing any of it: (1) shortfall severity — already exists (`parallelShortfallSeverity`), now explicitly surfaced as a labeled degree in the longText rather than only implied by critical/warning; (2) useful-vs-insignificant parallel work — compares the Gather/Gather Merge node's own `actualTimeMs` against `context.totalActualTimeMs`, flagging when a plan paid for parallel workers but the parallel portion is a trivial share of total runtime; (3) Gather/Gather Merge overhead — the gather node's own self-time (its `actualTimeMs` minus the max child's) when that figure is derivable and material | **Per-worker imbalance is explicitly OUT — confirmed by checking the parser first**: `extendedFields.ts` only derives aggregate `workersLaunched`/`workersPlanned` off `Workers Launched`/`Workers Planned`; Postgres's own per-worker `Workers` array (individual worker actual rows/time, when `EXPLAIN (ANALYZE, VERBOSE)` includes it) is not parsed anywhere in this codebase today. Inventing a per-worker-skew finding without that data would be exactly the fabrication this story's own instruction forbids — if per-worker parsing is ever added, this is the natural follow-up, not something to fake now |
| 25.7 — Root cause grouping | `cardinalityPropagation.ts`'s `linkPropagatedFindings` (25.1) feeds a new `groupByRootCause(root): RootCauseGroup[]`, `RootCauseGroup = { primary: Finding, consequences: Finding[] }` | A finding with no `causedBy` edge but at least one `contributesTo` edge becomes a group's `primary`; everything it transitively `contributesTo` becomes `consequences`, deduped by family (reuses `dedupeByFamily` again) so an equivalent recommendation never appears twice across primary and consequence text | Purely a data-layer story — no UI surface specified here. Findings-panel/summary rendering of `RootCauseGroup[]` is a natural follow-up but out of this story's scope, same as Episode 24's disclosed `buildStatRows.ts` follow-up: named explicitly rather than silently assumed |

**Testing**: every new/changed rule gets the same positive/negative fixture pair `rule-engine-authoring` requires, plus a dedicated multi-hop fixture (scan → nested loop → aggregate, the story's own worked example) exercising `linkPropagatedFindings` end-to-end — asserting the exact edge list, not just that "some relationship" was found. 25.4's materiality rework needs both worked examples from the story (est 1→50 non-material, est 10→500,000 material) as explicit regression tests, since this replaces existing binary-severity behavior other tests may currently assert against.
