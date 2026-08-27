# Backlog Status

**This is the file that changes constantly — check it first in any Claude Code or Codex session to know what's actually been built, versus reading `08-episodes-and-stories.md` cold and assuming nothing exists yet.** `08-episodes-and-stories.md` is the stable spec; this file is the live state layered on top of it.

Status values: `not started` / `in progress` / `blocked` / `done`

## Episode 1 — Postgres plan ingestion
| Story | Status | Notes |
|---|---|---|
| 1.1 — Parse well-formed JSON plans | done | |
| 1.2 — Parse well-formed TEXT plans | in progress | |

## Episode 2 — SQL Server plan ingestion
| Story | Status | Notes |
|---|---|---|
| 2.1 — Parse `.sqlplan` / Showplan XML | not started | |

## Episode 3 — Snowflake plan ingestion
| Story | Status | Notes |
|---|---|---|
| 3.1 — Parse operator-stats JSON/table output into a tree | not started | |

## Episode 4 — Normalization layer
| Story | Status | Notes |
|---|---|---|
| 4.1 — Normalized operator taxonomy | not started | |

## Episode 5 — Rule engine & plain-language explanations
| Story | Status | Notes |
|---|---|---|
| 5.1 — Core Must-have rule set | not started | |
| 5.2 — "What am I looking at" top-level summary | not started | |

## Episode 6 — Node-graph visualization
| Story | Status | Notes |
|---|---|---|
| 6.1 — Render the plan tree with cost/time encoding | not started | |
| 6.2 — Rich node detail panel with operator glossary | not started | Needs field-catalog retrofit on parsers first — see docs/10-node-stats-field-catalog.md |

## Episode 7 — Privacy & client-side architecture
| Story | Status | Notes |
|---|---|---|
| 7.1 — Fully client-side rule-based path | not started | |

## Episode 8 — Landing page & positioning
| Story | Status | Notes |
|---|---|---|
| 8.1 — Above-the-fold disambiguation | not started | |

## Episode 9 — Funnel touchpoints
| Story | Status | Notes |
|---|---|---|
| 9.1 — Contextual, dismissible product callouts | not started | |

## Episode 10 — LLM narrative mode
| Story | Status | Notes |
|---|---|---|
| 10.1 — Opt-in narrative generation from structured findings | not started | |

## Episode 11 — Sharing / publish
| Story | Status | Notes |
|---|---|---|
| 11.1 — Explicit opt-in plan publishing (backend-based) | not started | |
| 11.2 — Client-side-only shareable link (no backend) | not started | New — see docs/08-episodes-and-stories.md |

## Episode 12 — Launch readiness & content tie-in
| Story | Status | Notes |
|---|---|---|
| 12.1 — Concept-to-content linking map | not started | |
| 12.2 — Soft-launch validation against real plans | not started | |

---

**IMPORTANT — this file ships with placeholder statuses.** I don't have live access to your actual repo, so Episode 1–7 statuses above are a rough guess based on our conversation, not a verified read of your code. Your first real task with this file: have Claude Code audit your actual `src/` against `08-episodes-and-stories.md` and correct every row here to match reality (see the prompt in the accompanying chat message). Everything from here forward should be kept current as you go — update the row the moment a story starts or finishes, as part of the same PR, not as a separate cleanup pass later.
