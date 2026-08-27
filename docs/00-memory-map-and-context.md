# PlanReader — Memory Map & Context

**Purpose of this file**: a single entry point for any agent (Claude Code, Codex, or a human) starting a session with limited or no prior context. It indexes what exists, why key decisions were made, and where to go for depth — it does not duplicate content from the other docs, it points at them. This file describes the *project's* memory (decisions, architecture, terminology); it does not know the current state of the actual codebase — see `docs/BACKLOG-STATUS.md` for that, which is the file that changes as work gets done.

## What PlanReader is, in one paragraph

A free, no-signup web tool that explains raw database execution plans (Postgres, SQL Server, Snowflake) in plain English with an interactive node-graph visualization, funneling qualified users toward two existing paid products (pgsuite for Postgres, QueryDoc for Snowflake). The rule-based explanation path is 100% client-side by architecture — no server ever sees a pasted plan by default.

## Doc index — what to read for what

| Question | Read |
|---|---|
| Why does this exist, who's it for, what's explicitly out of scope | `03-prd-v1.md` |
| What competitors exist and what gap is PlanReader filling | `01-competitive-analysis.md` |
| What's Must/Should/Could-have, and why | `02-feature-prioritization-moscow.md` |
| How is it built — parser architecture, rule engine, visualization stack, privacy model | `04-technical-spec-v1.md` |
| Landing page copy, meta tags, disambiguation strategy | `05-landing-page-positioning.md` |
| How this connects to existing @scalingbackend content and launches | `06-content-launch-plan.md` |
| Real-world evidence behind specific edge-case decisions (why a rule is shaped the way it is) | `07-additional-tool-limitations.md` |
| The actual buildable backlog — stories, acceptance criteria, tests, edge cases | `08-episodes-and-stories.md` |
| How to set up locally, branch, test, and use Claude Code/Codex | `09-local-dev-setup.md` |
| Exact field-by-field mapping for predicates/indexes/joins/costs/buffers/spill/cache/time/rows across all three engines | `10-node-stats-field-catalog.md` |
| **What's actually been built so far, what's in progress, what's next** | `BACKLOG-STATUS.md` — **check this first in any session** |
| How to write a new story so both agents pick it up correctly | `STORY_TEMPLATE.md` |

## Decisions worth remembering (the "why," not just the "what")

These are the calls that shape a lot of downstream code — if a future change seems to contradict one of these, that's a signal to re-read the relevant doc before proceeding, not to assume the decision was arbitrary.

- **Client-side-only for the rule-based path, by architecture, not by policy.** This is the single most load-bearing decision in the project (`privacy-architecture` skill). It exists because a real competitor (PEV2) lost user trust over a server-storage default even when the tool was technically capable of running locally — see `07-additional-tool-limitations.md` §5.
- **Rules-first, LLM-optional, not LLM-first.** The rule engine produces deterministic, testable findings; the LLM (when opted into) phrases those findings, it doesn't generate its own diagnosis. This bounds cost and hallucination risk for a free public tool with unpredictable traffic. See `04-technical-spec-v1.md` §2.
- **A single pasted plan is one snapshot — say so, don't imply otherwise.** Parameter sniffing (SQL Server) and plan instability (Snowflake) can't be diagnosed from one plan. This is a stated non-goal (`03-prd-v1.md`), not a gap to quietly try to solve — it's an honesty commitment that differentiates PlanReader from every competitor reviewed.
- **Normalization never discards information.** Every `PlanNode`, regardless of engine, keeps `rawOperatorLabel` and the full untouched `attributes` bag alongside normalized fields. This is what let the field catalog (`10-node-stats-field-catalog.md`) get added *after* the base model existed without a breaking rewrite.
- **General education and specific diagnosis are structurally separate**, everywhere this distinction could apply: the operator glossary (general) vs. rule engine `Warning`s (specific) in the detail panel; the parameter-sensitivity honesty note (general limitation) vs. an actual finding (specific). This pattern recurs because conflating the two is a recognized failure mode, not a one-off panel design choice.
- **Not every engine has an equivalent field for everything.** Postgres has no reliable index-type field; Snowflake has no abstract cost-unit concept; SQL Server doesn't split buffer hits from disk reads the way Postgres does. The field catalog's "genuine cross-engine gaps" section is the canonical list — don't invent a value to fill a gap that's architecturally absent in the source engine.
- **Real-world input is routinely malformed, and that's normal, not exceptional.** Postgres has shipped invalid JSON (duplicate keys); SQL Server's `ShowPlanXML` is often not document-root; common copy-paste habits (`\x on`, `auto_explain` log capture) mangle input. Parsing robustness is a Must-have, not hardening done later — see each `*-plan-parsing` skill.

## Terminology (so agents use consistent vocabulary across sessions)

- **`PlanNode`** — the shared internal model every engine parser compiles down to (`04-technical-spec-v1.md` §1.4, extended in `10-node-stats-field-catalog.md`).
- **`operatorType`** — the normalized cross-engine operator vocabulary (`seq_scan`, `hash_join`, etc.), distinct from `rawOperatorLabel` (the engine's own term for it) and from `join.logicalType` (inner/outer/semi/anti — a different axis from the join *algorithm*, which IS the `operatorType`).
- **`Warning`** — a specific, rule-engine-generated finding about one node in one submitted plan. Never confuse with a glossary entry (general, plan-independent).
- **`OperatorGlossaryEntry`** — general, static education about an operator type, independent of any specific plan.
- **Episode** — a group of related stories (an epic, in more standard agile terminology) in `08-episodes-and-stories.md`.
- **Story** — one buildable unit of work with acceptance criteria, a testing approach, and an edge-case table.

## Skills index (repo-scoped, `.claude/skills/`)

| Skill | Applies to |
|---|---|
| `postgres-plan-parsing` | `src/parsers/postgres/` |
| `sqlserver-plan-parsing` | `src/parsers/sqlserver/` |
| `snowflake-plan-parsing` | `src/parsers/snowflake/` |
| `plan-normalization` | `src/parsers/normalize.ts`, operator mapping tables |
| `rule-engine-authoring` | `src/rules/` |
| `graph-visualization` | `src/graph/` |
| `operator-glossary-content` | `src/graph/glossary/` |
| `privacy-architecture` | Any network call, logging, or error-handling change, anywhere |

## How this file should be maintained

Update this file when a *decision* changes or a new one is made worth remembering across sessions — not when a story gets implemented (that's `BACKLOG-STATUS.md`'s job) and not when a doc gets a wording tweak. If you find yourself re-explaining the same piece of "why" in a Claude Code or Codex prompt more than once, that's the signal it belongs here instead.
