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
| 3.1 — Parse operator-stats JSON/table output into a tree | done | `src/parsers/snowflake/` (`buildTree.ts`, `rows.ts`) |

## Episode 4 — Normalization layer
| Story | Status | Notes |
|---|---|---|
| 4.1 — Normalized operator taxonomy | done | `src/parsers/normalize.ts`, per-engine `operatorMap.ts`; cross-engine sweep in `src/parsers/__tests__/operatorTaxonomy.test.ts` (tracks unmapped labels deliberately, e.g. SQL Server's window-function trio) |

## Episode 5 — Rule engine & plain-language explanations
| Story | Status | Notes |
|---|---|---|
| 5.1 — Core Must-have rule set | done | 7 rules in `src/rules/`: seq-scan-on-large-table, bad-row-estimate, disk-spill, high-loop-count, exploding-join, missing-index-opportunity, parameter-sensitivity-honesty-note |
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
| 14.1 — Node matching algorithm | done | `src/comparison/matchNodes.ts`: `matchNodes(planA, planB): NodeMatch[]`, layered fallback (exact signature → relation/index identity → positional-only → unmatched), hash-map grouping throughout (no O(n·m) scan). Cross-engine rejected via `PlanComparisonError`. `summarizeMatches()` computes `matchRatio`/`lowConfidence` for the "these may not be comparable plans" warning, ready for 14.2 to render. **Note**: `PlanNode` has no normalized relation-name field (only `index.name`, and only SQL Server populates it) — matching reads per-engine `attributes` keys directly instead (documented in-file); worth a normalized field if a second consumer needs relation identity |
| 14.2 — Comparison view | done | `src/graph/comparison/PlanComparisonView.tsx`: two `PlanGraph` panes (Episode 6/15's existing DOM/SVG+canvas pipeline, not forked) overlaid with a `matchNodes` result via a new `comparisonOverlays` prop threaded through `buildGraphElements.ts` → `PlanNodeCard.tsx`/`canvasDraw.ts`/`AccessiblePlanList.tsx` (all three kept in visual parity, per the canvas skill's accessibility-not-optional rule). Three distinct, text-labeled states (changed/added/removed — matched stays neutral); a changed node's card shows the concrete delta ("Seq Scan → Index Scan", cost/time %). Synced selection + pan-to-node reuses Story 13.1's existing `focusNodeId`/`onFocusHandled` pair plus a new `onNodeSelected` callback — **the one non-obvious trap**: `onNodeSelected` must fire only for a selection that originates in that pane (a click), never echo back out for an incoming `focusNodeId`, or two synced panes ping-pong forever (hit this exact infinite-render loop during implementation; see `PlanGraph.tsx`'s comment on the effect). Plain-language summary strip + low-confidence warning via new `src/comparison/summary.ts`. Cross-engine plans show `PlanComparisonError`'s message directly, no broken view. Wired into `PlanReaderPage.tsx` via a "Compare with another plan" toggle + `ComparePasteBox.tsx` (deliberately not persisted/restorable/shareable — only the primary plan is). Orientation toggle (side-by-side/stacked) always stacks below 720px. **Known gaps, stated honestly**: no pixel-snapshot visual-regression test added for the comparison view specifically (functional e2e + component tests cover it instead — see `e2e/plan-comparison.spec.ts`); a multi-statement batch on either side only compares the primary's active tab against the comparison plan's first statement, not a full N×M pairing UI |

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

---

**`docs/11-manual-testing-gaps-episode8.md` is fully closed** — all 4 original gaps resolved (one real fix, two confirmed data-source limitations rather than bugs, one confirmed already-correct), plus a real Snowflake time-breakdown gap and a real SQL Server composite-seek-predicate bug found during re-verification, both fixed. Nothing outstanding there.

## Episode 18 — UI redesign

Spec: `docs/12-ui-redesign-spec.md` (status: confirmed). Building on branch `new-ui`, not `main` — merge back to `main` per-story or once the whole episode is stable, same as any other episode, but note the branch deviates from the usual `feat/N.M-slug`-per-story convention (`CLAUDE.md`) since this episode spans the whole app shell and the user asked to keep one branch for the full effort. **Full stories**: `docs/08-episodes-and-stories.md` Episode 18.

| Story | Status | Notes |
|---|---|---|
| 18.1 — Design token consolidation | done | `src/styles/tokens.css` — one canonical dark palette (spec §1) plus every legacy `--pr-*`/`--pg-*`/`--dp-*`/`--fl-*`/index.css token kept as a same-file alias (zero usage-site risk across every existing component). Every `prefers-color-scheme` branch under `src/` deleted, including `src/index.css`'s leftover Vite-template one. Global `:focus-visible` outline rule added (`src/index.css`) — spec's "no default browser ring anywhere" requirement, not previously implemented anywhere. Two extension tokens added beyond spec §1's base table (`--color-success`, `--color-comparison-removed`) for Episode 14's added/removed comparison states, which the spec's palette didn't anticipate — same pattern spec already uses for the funnel-callout teal. `src/styles/__tests__/tokens.test.ts` locks in both invariants (single declaration site, zero `prefers-color-scheme`). Visual-regression baselines re-captured (`e2e/visual-regression.spec.ts-snapshots/`) — inspected, not just re-generated blind. **Known follow-up, not this story's scope**: React Flow's own `<Controls />` widget (`@xyflow/react/dist/style.css`) still renders its light-mode default chrome — it doesn't read this app's custom properties at all, restyling it needs its own override, not a token change |
| 18.2 — App shell layout | done | `.plan-shell` (`src/app/PlanReaderPage.tsx` + `planReaderPage.css`): three-column `container-type: inline-size` grid (spec §2's exact `clamp()`/`minmax()` template), app bar (brand/engine badge/spacer/Beginner-Expert+walkthrough placeholders/compare-toggle/share/export-placeholder, correct element order), Findings in the left rail, summary+metrics-strip+graph in the centre, detail panel in the right rail. `@container` (not `@media`) drives both breakpoints, per spec's "measures against the shell's own width" goal: 1180px (panel un-fixed vs. fixed-overlay-with-scrim) and 860px (Findings/graph become ResizeObserver-driven tabs — jsdom's ResizeObserver is a no-op stub, so this branch is e2e-only, `e2e/plan-shell.spec.ts`). `PlanGraph.tsx` gained `externalDetailPanel`/`onDetailPanelChange` (opt-in, default-off — every other caller, including each `PlanComparisonView` pane, is unaffected) so the panel can be a true grid-track sibling instead of nested inside PlanGraph's own DOM; `DetailPanel` gained a `variant="shell"` prop for this. **Three real bugs found and fixed via actual e2e runs, not assumed to work**: (1) `display: none` on the right-rail wrapper below 1180px also hid its `position: fixed` child — display, unlike visibility, can't be escaped by a descendant; fixed to a 0-width grid column instead. (2) `height: 100%` on the shell-variant panel resolved to zero against a stretched-but-`auto`-sized CSS Grid item (a known cross-browser gotcha) — removed, natural content height inside the rail's own `overflow-y: auto` was correct anyway. (3) `align-content`'s grid default distributed the narrow-breakpoint's `min-height` floor across every auto-row including the tabs row, rendering ~130px-tall tab buttons — fixed with `align-content: start`. Also fixed a real, unrelated blocker hit while verifying this story: `src/index.css`'s `#root` had a leftover Vite-template `width: 1126px` capping every page under it regardless of viewport, so the 1180px breakpoint could never actually be reached in a real browser — corrected to `width: 100%`. **Deliberately deferred, each to its owning story** (all noted in-code): "filename" app-bar slot and Plan Input living in the rail (18.5, no file-input/collapsed-preview concept exists yet); Beginner/Expert and "Walk me through it" wiring (18.3, 18.9); share/export icon-only-at-narrow-width and PNG export itself (18.4 icon set, 18.11); collapsed-node-count and colour-legend in the metrics strip (18.4, meaningless without the encoding they'd explain). **One open, documented deviation from the literal spec value**: shell height is `min(78dvh, 760px)`, not spec's literal `100dvh` — Story 8.1's hero renders unconditionally above the shell (spec's own mockup didn't have to share space with one), so a literal 100dvh would push the shell mostly off-screen; revisit if a later story addresses hero visibility once a plan is loaded. 696 unit tests + 40 e2e tests passing, lint/typecheck clean |
| 18.3 — Beginner/Expert mode as page-level state | not started | Lifts `expertMode` out of `DetailPanel.tsx`'s local state — that file already flags this as a TODO |
| 18.4 — Node encoding, operator icons, edge rendering | not started | `rankdir: "BT"`, severity ring, new operator-icon map, orthogonal `smoothstep` edges with fixed-size arrowheads |
| 18.5 — Landing/input redesign | not started | File drop/picker via `FileReader` + existing `analyzePlanText()`, per-engine sample loaders from `src/fixtures/` |
| 18.6 — Error and edge-state treatments | not started | Three severity treatments for `PlanParseError` messages; drop the "parsing…" indicator if parsing stays synchronous |
| 18.7 — Detail panel Beginner/Expert densities | not started | Depends on 18.3 for the lifted mode state |
| 18.8 — Search & filter palette | not started | `/` / `⌘K`, dims non-matches to 32% opacity, reuses `focusNodeId` |
| 18.9 — Guided walkthrough | not started | New `src/graph/walkthrough/`; spec's own "longest single item" |
| 18.10 — Large-plan canvas mode: banner, degrade, list toggle | not started | Restyle of Episode 15's existing canvas path, not new capability |
| 18.11 — Batch tabs, share link, PNG export | not started | PNG export is new; offscreen-renders the existing `canvasDraw.ts` path |
| 18.12 — Mobile breakpoints | not started | Findings-tab-leads, bottom sheet below 480px, drag-and-drop absent on touch |
| 18.13 — Content stack | not started | `posts.ts` starts with zero entries by design — content is a separate, later fill-in (tracks against Episode 12.1's real-URL blocker); the component itself is not blocked |
| 18.14 — Comparison view: restyle onto new shell | not started | **Read before starting**: spec §8 ("parked — plan comparison") describes the feature Episode 14 already shipped, written without that context — this story restyles the existing `PlanComparisonView`, it does not redesign its interaction per spec §8's modal concept |

Keep this file current going forward — update the relevant row the moment a story starts or finishes, as part of the same PR/commit, not as a separate cleanup pass later.
