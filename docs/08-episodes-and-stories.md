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
