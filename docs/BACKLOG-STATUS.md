# Backlog Status

**This is the file that changes constantly — check it first in any Claude Code or Codex session to know what's actually been built, versus reading `08-episodes-and-stories.md` cold and assuming nothing exists yet.** `08-episodes-and-stories.md` is the stable spec; this file is the live state layered on top of it.

Status values: `not started` / `in progress` / `blocked` / `done`

_Last audited against `src/` and git history on 2026-08-27 (506/506 tests passing at the time)._

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
| 13.1 — Complete findings list, separate from the synthesized summary | not started | New — from manual testing feedback |

## Episode 14 — Execution plan comparison
| Story | Status | Notes |
|---|---|---|
| 14.1 — Node matching algorithm | not started | New — from manual testing feedback |
| 14.2 — Comparison view | not started | Depends on 14.1 |

## Episode 15 — Canvas-based rendering for large plans
| Story | Status | Notes |
|---|---|---|
| 15.1 — Hybrid rendering strategy: DOM/SVG below a threshold, canvas above it | not started | New — from manual testing feedback. Architecture revision to Episode 6/Tech Spec §3 |
| 15.2 — Accessible fallback for canvas-rendered plans | not started | Required alongside 15.1, not a follow-up |

## Episode 16 — UI performance and responsiveness
| Story | Status | Notes |
|---|---|---|
| 16.1 — Diagnose and fix detail panel open latency | not started | New — from manual testing feedback |
| 16.2 — General page responsiveness audit | not started | |

## Episode 17 — Local browser persistence
| Story | Status | Notes |
|---|---|---|
| 17.1 — Persist the current plan across page reloads | not started | New — from manual testing feedback |
| 17.2 — Recent plans list | not started | |

---

**`docs/11-manual-testing-gaps-episode8.md` is fully closed** — all 4 original gaps resolved (one real fix, two confirmed data-source limitations rather than bugs, one confirmed already-correct), plus a real Snowflake time-breakdown gap and a real SQL Server composite-seek-predicate bug found during re-verification, both fixed. Nothing outstanding there.

Keep this file current going forward — update the relevant row the moment a story starts or finishes, as part of the same PR/commit, not as a separate cleanup pass later.
