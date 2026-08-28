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
