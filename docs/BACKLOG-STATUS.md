# Backlog Status

**This is the file that changes constantly — check it first in any Claude Code or Codex session to know what's actually been built, versus reading `08-episodes-and-stories.md` cold and assuming nothing exists yet.** `08-episodes-and-stories.md` is the stable spec; this file is the live state layered on top of it.

Status values: `not started` / `in progress` / `blocked` / `done`

_Last audited against `src/` and git history on 2026-08-28 (652/652 tests passing at the time)._

## Episode 1 — Postgres plan ingestion
| Story | Status | Notes |
|---|---|---|
| 1.1 — Parse well-formed JSON plans | done | `src/parsers/postgres/parseJsonPlan.ts` + fixtures |
| 1.2 — Parse well-formed TEXT plans | done | `src/parsers/postgres/textParser.ts` + 11 TEXT fixtures (8 happy-path: estimate-only, InitPlan/SubPlan, psql header/footer + record mode, `auto_explain` capture, arrow-operator query text, multi-way join, simple scan; 3 deliberately-invalid: non-plan text, truncated input) |

## Episode 2 — SQL Server plan ingestion
| Story | Status | Notes |
|---|---|---|
| 2.1 — Parse `.sqlplan` / Showplan XML | done | `src/parsers/sqlserver/parseShowplanXml.ts`. Composite (multi-column) seek predicate truncation bug found and fixed this session — see `composite-index-seek.xml` fixture |

## Episode 3 — Snowflake plan ingestion
| Story | Status | Notes |
|---|---|---|
| 3.1 — Parse operator-stats JSON/table output into a tree | done | `src/parsers/snowflake/` (`buildTree.ts`, `rows.ts`). **Two real near-miss-tolerance gaps found and fixed via manual testing with a user-supplied export** (this story's own edge-case table already calls for "tolerant parsing of common near-miss formats"): (1) a singular `parentOperatorId` field (one id, not Snowflake's own plural/array `PARENT_OPERATORS`) made every row look parentless — `parseRawRows` now accepts it as a `parentOperators` alias, reconstructing the real tree instead of N disconnected "root" nodes; (2) an export with no separate `statistics`/`operatorStatistics` container at all (row/time figures sitting as plain sibling fields on the row) lost every `actualRows` figure — rows with an empty statistics lookup now fall back to the row's own unclaimed fields as ad hoc statistics. Fixture: `singular-parent-flat-stats.json`. Separately confirmed `"HashJoin"` as an `operatorType` string is NOT real Snowflake vocabulary (this app's own `operatorMap.ts` already documents Snowflake exposing only a generic `"Join"`, no algorithm split) — correctly falls back to `unknown` + the honest "we don't have a detailed explanation" message; not added to the operator map |

## Episode 4 — Normalization layer
| Story | Status | Notes |
|---|---|---|
| 4.1 — Normalized operator taxonomy | done | `src/parsers/normalize.ts`, per-engine `operatorMap.ts`; cross-engine sweep in `src/parsers/__tests__/operatorTaxonomy.test.ts` (tracks unmapped labels deliberately, e.g. SQL Server's window-function trio) |

## Episode 5 — Rule engine & plain-language explanations
| Story | Status | Notes |
|---|---|---|
| 5.1 — Core Must-have rule set | done | 7 rules in `src/rules/`: seq-scan-on-large-table, bad-row-estimate, disk-spill, high-loop-count, exploding-join, missing-index-opportunity, parameter-sensitivity-honesty-note. **User-requested comprehensive coverage pass** (this session): every rule that CAN fire on Postgres now also has an end-to-end integration test — a real `EXPLAIN (FORMAT JSON)` fixture built to cross that rule's own threshold, driven through the real `analyzePlanText` pipeline, not just the rule function in isolation via a hand-built `PlanNode` (which can't catch a parser field-name typo the way a real fixture can). New fixtures: `rule-bad-row-estimate.json`, `rule-seq-scan-large-table.json`, `rule-disk-spill-sort.json`, `rule-disk-spill-hash.json`, `rule-high-loop-count.json`, `rule-exploding-join.json`, `rule-non-sargable-function-wrapped.json`, `rule-non-sargable-leading-wildcard.json`, `rule-parameter-sensitivity.json` — see `src/app/__tests__/postgresRuleTriggerScenarios.test.ts`. All 12 fired exactly as expected on first run — no wiring gaps found. Separately, `src/app/__tests__/postgresAllOperatorTypesCoverage.test.ts` drives all 40 `POSTGRES_OPERATOR_MAP` entries through the full pipeline in one synthetic plan: no `unknown` types, `buildStatRows` never throws or renders `NaN`/`undefined` for any of them |
| 5.2 — "What am I looking at" top-level summary | done | `src/rules/summarize.ts` |

## Episode 6 — Node-graph visualization
| Story | Status | Notes |
|---|---|---|
| 6.1 — Render the plan tree with cost/time encoding | done | `src/graph/PlanGraph.tsx`, `PlanNodeCard.tsx`, `buildGraphElements.ts`. Large-plan zoom-floor fix and predicate/seek hover tooltip added this session |
| 6.2 — Rich node detail panel with operator glossary | done | **Field-catalog retrofit is done** (see below) — the "needs retrofit first" blocker this row shipped with is stale. `DetailPanel.tsx` + 7 section components, `src/graph/glossary/` (entries + coverage test). Long predicate/seek/join-condition values render as full-width blocks (added this session) |

**Field-catalog retrofit specifically** (docs/10-node-stats-field-catalog.md): done. `PlanNode` (`src/parsers/normalize.ts`) carries `predicate`, `index`, `join`, `io`, `spill`, `pruning`, `parallel`, and `timeBreakdown` (Snowflake-specific, added this session after finding the original retrofit never promoted it, so Snowflake nodes silently had no Time row). All three parsers populate these per the catalog; `buildStatRows.ts` renders every field per-engine with honest gap states, no fabricated values.

## Episode 7 — Privacy & client-side architecture
| Story | Status | Notes |
|---|---|---|
| 7.1 — Fully client-side rule-based path | done | `src/privacy/` (`networkGuard.ts`, `config.ts` with hard-off defaults for the not-yet-built LLM/publish features), `e2e/privacy-no-network-calls.spec.ts` |

## Episode 8 — Landing page & positioning
| Story | Status | Notes |
|---|---|---|
| 8.1 — Above-the-fold disambiguation | done | `src/app/positioningCopy.ts`, `PlanReaderPage.tsx`, `e2e/positioning.spec.ts` |

## Episode 9 — Funnel touchpoints
| Story | Status | Notes |
|---|---|---|
| 9.1 — Contextual, dismissible product callouts | done | `src/graph/detailPanel/funnelCallouts.ts` + `FunnelCallout.tsx`, keyed strictly by node engine, session-scoped per-product dismissal. **Uses placeholder URLs** (`pgsuite.example.com` / `querydoc.example.com`) — swap for real domains before launch |

## Episode 10 — LLM narrative mode
| Story | Status | Notes |
|---|---|---|
| 10.1 — Opt-in narrative generation from structured findings | not started | Explicitly deferred by the user this session. Only a defensive default-off constant exists so far (`LLM_NARRATIVE_MODE_DEFAULT_ENABLED` in `src/privacy/config.ts`) — no UI, no API call |

## Episode 11 — Sharing / publish
| Story | Status | Notes |
|---|---|---|
| 11.1 — Explicit opt-in plan publishing (backend-based) | dropped | Superseded by 11.2 — client-side-only shareable link covers the sharing use case without a backend, staying within the 100%-client-side architecture. Its defensive default-off constant (`PLAN_PUBLISHING_DEFAULT_ENABLED`) removed from `src/privacy/config.ts` as dead code |
| 11.2 — Client-side-only shareable link (no backend) | done | `src/app/shareLink.ts` (`lz-string` compression, versioned envelope, URL fragment not query param), `ShareLinkButton.tsx`, wired into `PlanReaderPage.tsx` (decodes+renders on load, no re-paste needed). Honest "too large" state (>2000 chars) and "link looks incomplete" state for truncated/mangled fragments. Network-call-guarding tests extend the Episode 7 suite; e2e test drives the real "copy shareable link" button end-to-end |

## Episode 12 — Launch readiness & content tie-in
| Story | Status | Notes |
|---|---|---|
| 12.1 — Concept-to-content linking map | blocked | Needs the real URLs/timestamps from the existing @scalingbackend video series and blog post; user declined to provide them this session — do not fabricate placeholder links claiming to be real content |
| 12.2 — Soft-launch validation against real plans | blocked | Mostly a manual launch process (soft-launch period, go/no-go checklist), not code. Its one buildable piece — aggregate-only parse-failure monitoring — needs a telemetry provider decision; user declined to provide one this session |

## Episode 13 — Complete recommendations coverage
| Story | Status | Notes |
|---|---|---|
| 13.1 — Complete findings list, separate from the synthesized summary | done | `src/rules/findings.ts` (`collectAllFindings`, no cap/dedup), `src/rules/findingCategory.ts` (severity/category filter data), `src/graph/findings/FindingsList.tsx` (collapsed-by-default toggle, severity + category filters, zero-findings state reuses Story 5.2's copy). Wired into `PlanReaderPage.tsx`; clicking an entry drives a new `PlanGraph` `focusNodeId`/`onFocusHandled` prop pair (`src/graph/collapse.ts`'s `findCollapsedAncestors` expands any collapsed ancestor first) so the click opens that node's real detail panel, not a duplicate view. Not virtualized (no fixture approaches list sizes where it'd matter) — noted as a deferred edge case in-code |

## Episode 14 — Execution plan comparison
| Story | Status | Notes |
|---|---|---|
| 14.1 — Node matching algorithm | not started | New — from manual testing feedback |
| 14.2 — Comparison view | not started | Depends on 14.1 |

## Episode 15 — Canvas-based rendering for large plans
| Story | Status | Notes |
|---|---|---|
| 15.1 — Hybrid rendering strategy: DOM/SVG below a threshold, canvas above it | done | `src/graph/canvas/`: `CanvasPlanGraph.tsx` (redraw-on-change via rAF, devicePixelRatio scaling, tab-visibility pause, drag-to-pan, wheel-zoom-toward-cursor), `canvasDraw.ts` (draws the SAME `PlanGraphNode`/`PlanGraphEdge` data the DOM/SVG path already computes — no second encoding pass), `hitTest.ts` + `viewportTransform.ts` (pure, unit-tested). `PlanGraph.tsx` switches modes at `CANVAS_NODE_COUNT_THRESHOLD = 300` — **not yet benchmarked against real browser numbers** (the story's own testing-approach item); chosen only to sit below Episode 6's 500-node collapse risk point. `COLLAPSE_NODE_COUNT_THRESHOLD` (collapse.ts) lowered 500→150 so DOM/SVG mode — which now only ever handles up to the canvas threshold — still gets real default-collapse coverage in its own range |
| 15.2 — Accessible fallback for canvas-rendered plans | done | `src/graph/canvas/AccessiblePlanList.tsx` — built alongside 15.1 in the same change, per the skill's "not optional, not a follow-up" rule, not after it. A native `<ul>` of `<button>`s (Tab/Enter/Space keyboard access for free) walking the same `PlanNode` tree and the same `collapsedIds` state as the canvas view — shared state, not a second view. Toggle button always visible in the canvas toolbar; the list itself only mounts once opened, so a huge plan a user never opens it for doesn't pay its DOM cost. Canvas itself carries `aria-hidden="true"`/`role="presentation"`. **Known gap, stated honestly**: doesn't offer arrow-key/search navigation — neither does the DOM/SVG path today (Episode 6 never built that), so this list matches actual current parity (click/Enter/Space) rather than overclaiming a scheme that doesn't exist anywhere yet |

Verified in a real browser, not just jsdom (which has no real `<canvas>` 2d context — `getContext('2d')` returns `null` there): `e2e/canvas-large-plan.spec.ts` generates a synthetic 320-node plan, confirms the canvas actually paints pixels (samples `getImageData`), and drives the full toggle → list → click → real detail-panel path end-to-end.

## Episode 16 — UI performance and responsiveness
| Story | Status | Notes |
|---|---|---|
| 16.1 — Diagnose and fix detail panel open latency | done | Diagnosis: per-node computations (glossary lookup, stat rows, contribution-%) were already O(1)/cheap — not the actual bottleneck. Fix applied anyway, matching the AC literally and guarding against regression: `StatsTable`, `WarningsSection`, `OperatorEducation`, `RawAttributes`, `QueryCorrelation` wrapped in `React.memo`; `buildStatRows`/`computeContributionPercent`/raw-attributes formatting wrapped in `useMemo` — verified via call-count spies in `detailPanelPerformance.test.ts` that these skip re-running on an unrelated re-render (e.g. the Beginner/Expert toggle) but still re-run on a genuine node change. Added the missing CSS open animation (`detailPanel.css`, transform/opacity only, `prefers-reduced-motion`-respecting — the AC's "no layout-thrashing" bullet was previously trivially true only because no animation existed at all). Large-attributes-bag edge case confirmed already-correct (collapsed by default) and locked in with a 500-field test. Canvas-mode "panel not blocked by graph rendering" edge case confirmed already-true architecturally (separate component subtrees) and locked in with a test |
| 16.2 — General page responsiveness audit | done | **Web Worker decision (evidence-based, not assumed)**: measured `analyzePlanText` (parse+normalize+rules+summarize) at up to a synthetic 10,000-node/2MB plan — single-digit-to-tens-of-ms, no evidence of a real main-thread-freeze problem at any plausible size. Conclusion: **not warranted currently**; permanent regression thresholds live in `src/app/__tests__/analyzePlanPerformance.test.ts`. Paste-handling path audited separately: `PasteBox`'s `onChange` is a plain controlled-input `setState`, one inherent O(n) copy per paste, nothing further to optimize; locked in with a 5MB-paste bounded-time test. **New finding, not fixed this pass**: a pathologically deep (not wide) plan — a long single-child chain — can overflow the JS call stack in the parsers' recursive tree-builders (environment-dependent exact depth, unlikely for a real query's plan shape); already degrades to the same friendly generic error as any other parse failure (verified — never a blank page), left as a known limitation rather than refactoring every recursive tree-walker across all 3 parsers + `src/graph`/`src/rules` to iterative, which is a much larger, separate effort disproportionate to this story's scope. Mobile responsiveness tested with real CPU throttling (Chrome DevTools Protocol, 4x rate — not just viewport-width emulation) in `e2e/mobile-cpu-throttled.spec.ts`. No Lighthouse/CI wiring added — no CI pipeline exists in this repo yet to wire it into |

## Episode 17 — Local browser persistence
| Story | Status | Notes |
|---|---|---|
| 17.1 — Persist the current plan across page reloads | done | `src/persistence/db.ts` (raw IndexedDB wrapper — `fake-indexeddb` new devDependency for tests, jsdom has no IndexedDB at all), `sessionPersistence.ts` (versioned envelope, mirrors Story 11.2's shareLink.ts — persists raw TEXT, re-parses via the existing `analyzePlanText` pipeline, never versions `PlanNode` itself). Debounced save (`debounce.ts`) on every successful analyze, gated by a "don't save this plan" checkbox in `PasteBox.tsx` (adjacent to the privacy statement, not buried). `RestoreSessionBanner.tsx` offers, never auto-loads. "Clear saved data" control wired to both stores. All edge cases from the story's table have explicit tests: quota-exceeded classification (`isQuotaExceeded` — fake-indexeddb doesn't enforce real quotas, so this is unit-tested directly against a synthetic `DOMException`), concurrent same-key writes across "tabs" (`Promise.all`, asserts no torn record — IndexedDB's per-record atomicity), version-mismatch and malformed-data both fail cleanly (never a crash), `indexedDB === undefined` (private-mode-like) degrades to "persistence unavailable" everywhere |
| 17.2 — Recent plans list | done | `src/persistence/recentPlans.ts` — capped at `RECENT_PLANS_LIMIT = 10`, oldest evicted on overflow (`savedAt` + a UUID tiebreaker for entries saved within the same millisecond — a real bug caught by testing a tight synchronous loop, not just a hypothetical). Label includes root operator + node count + timestamp (distinguishing-detail edge case). `RecentPlansList.tsx` — collapsed by default (same pattern as Episode 13's FindingsList), individually deletable, "Clear all" scoped to this list only (doesn't touch a pending session-restore offer — separate control, separate test). Never syncs anywhere — plain per-browser-profile IndexedDB |

Verified in a real browser, not just fake-indexeddb: `e2e/local-persistence.spec.ts` (save/reload/restore, dismiss-then-still-available, recent-plans add/reopen, don't-save opt-out, clear-saved-data) and a dedicated privacy check extending Episode 7's guarding per the story's own explicit requirement — `e2e/privacy-no-network-calls.spec.ts`'s new "Story 17.1/17.2" test drives the full save → reload → restore → browse-recent-plans round trip with network interception active, asserting zero outbound requests.

## Episode 20 — Multi-statement batch usability (large stored-procedure plans)
| Story | Status | Notes |
|---|---|---|
| 20.1 — Group trivial statements in the batch tab strip; fix comment-glued labels | done | `statementTabSummary.ts`: `isTrivialStatement` (reuses `statementSeverity`/`formatStatementDuration`, never a third drifting definition), `buildStatementTabRows` (adjacency-grouped, never hides a run containing the active statement), `findDefaultStatementIndex` (batch now opens on the first real statement, not statement 0's accident-of-ordering `DECLARE`). `analyzePlan.ts`'s `stripLeadingComments` fixes SQL Server's comment-glued `StatementText` labels. `PlanReaderPage.tsx` wires an `expandedStatementGroups` Set (reset alongside `activeStatementIndex` on every new plan/New-plan). Verified against the real ~300-statement stored-proc plan that motivated this story: tab strip collapsed to ~8 rows, real graph visible with no scrolling. Fixtures: `comment-glued-statement-labels.xml`, `many-trivial-statements.xml` |
| 20.2 — Fix unwanted page-scroll on node click / panel close (missing `preventScroll`) | done | Root cause confirmed and fixed: `PlanNodeCard.tsx`'s click handler and `PlanGraph.tsx`'s close-panel focus-restore both called bare `.focus()`, whose default `scrollIntoView` walks up to the outer page; both (plus `DetailPanel.tsx`'s open-focus effect, same pattern) now pass `{ preventScroll: true }`. `WalkthroughOverlay`/`SearchPalette` deliberately left unchanged — their focus calls are supposed to bring the viewport to new content. **Correction to the original manual-testing report**: the narrow-viewport detail-panel scrim it suspected was missing already exists and works (`.plan-shell__detail-scrim`, Episode 18 Story 18.2) — what read as "missing" was `rgba(0,0,0,0.5)` over an already near-black theme being low-contrast, not an absent element; no code change needed there |
| 20.3 — Add a way back: collapse an expanded control-flow group | done | Real gap found in manual testing: Story 20.1 only built one direction of the toggle — the expand button vanished once clicked, with nothing to collapse it back. `StatementTabRow`'s `"group"` variant gained `expanded: boolean`; an expanded run now keeps its own group row ("Collapse N control-flow statements") right before the tabs it reveals. Verified live: expand a 44-statement run, collapse it back, tab strip returns to its original state |
| 20.4 — Findings panel covers the whole batch, not just the active statement | done | Real gap found in manual testing: `FindingsList` was scoped to `activeStatement.root` only — every OTHER statement's findings (including plan-wide info notes sitting inside a collapsed control-flow group) were invisible. `src/rules/findings.ts`'s new `collectFindingsAcrossStatements` merges across every statement, deduping the two plan-wide honesty notes (parameter-sensitivity, estimate-only) to their first occurrence — without this, ~130 statements each carrying the same 2 notes would flood the panel with ~260 duplicate lines. `FindingsList` now shows a statement-label badge on any finding not on the active statement; clicking one switches statements (via the same `switchToStatement` reset logic the tab-click handler already used) and focuses the node. Verified live: Findings count went 3 → 9 (whole batch, notes deduped), clicking a badged finding correctly switched tabs and opened the right node |

## Episode 21 — Buffer/cache and disk-I/O efficiency rule
| Story | Status | Notes |
|---|---|---|
| 21.1 — `buffer-cache-inefficiency` rule (Postgres/SQL Server hit ratio, Snowflake disk-I/O time share) | done | `src/rules/bufferCacheInefficiency.ts`, registered in `ALL_RULES`. Postgres/SQL Server share one code path over `io.bufferHits`/`io.bufferReads` (Postgres exact via `Shared`/`Local Hit`/`Read Blocks`, requires `BUFFERS`; SQL Server approximate via logical/physical reads, wording says so explicitly). Snowflake uses `timeBreakdown`'s local+remote disk-I/O percentage share instead (no per-node cache-hit field exists there). New `"I/O issues"` `FindingCategory`. End-to-end ground-truth cross-check added against real fixtures (`postgres/low-buffer-cache-hit-ratio.json` fires, `postgres/simple-seq-scan.json` doesn't — no separate fixture-corpus analyzer exists in this repo to cross-check against, the rule engine itself is the analyzer) |
| 21.2 — Exclude SQL Server read-ahead reads from the signal | done | Real parser gap found while re-verifying against the field catalog: `ActualReadAheads` (`RunTimeCountersPerThread`) wasn't read at all. Added `io.readAheads` (`normalize.ts`), populated in `parseShowplanXml.ts` (`sumThreadAttr`, same pattern as logical/physical reads), excluded from the read count before both the volume floor and the ratio in `bufferCacheInefficiency.ts` — disclosed in `longText` when it actually changes the outcome. Fixture: `sqlserver/read-ahead-heavy-scan.xml`. Critical negative test (huge raw physical-reads count almost entirely read-ahead → must not fire) covered at both the unit and end-to-end level. **Scope correction**: a parallel ask for a Snowflake query-level cache-hit field was investigated and NOT built — that statistic lives in `QUERY_HISTORY`, a different data source than `GET_QUERY_OPERATOR_STATS()` (the only input this app's Snowflake parser accepts); building it would mean accepting a second paste, a real scope decision not folded into this story. See `docs/10-node-stats-field-catalog.md` §5 and the `snowflake-plan-parsing` skill for the honest gap note. **Retrofit** (found during a later detail-panel Beginner/Expert audit): `buildStatRows.ts` never surfaced `io.readAheads` in "This node's numbers" at all — added a "Read-ahead reads" row right after "Disk reads" so a large read-ahead-driven `Disk reads` figure has its own explanation in the panel, not just in the rule's prose. 943/943 tests passing |

---



**`docs/11-manual-testing-gaps-episode8.md` is fully closed** — all 4 original gaps resolved (one real fix, two confirmed data-source limitations rather than bugs, one confirmed already-correct), plus a real Snowflake time-breakdown gap and a real SQL Server composite-seek-predicate bug found during re-verification, both fixed. Nothing outstanding there.

Keep this file current going forward — update the relevant row the moment a story starts or finishes, as part of the same PR/commit, not as a separate cleanup pass later.
