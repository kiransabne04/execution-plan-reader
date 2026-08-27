## Commands
- `npm run dev` — start dev server
- `npm test` — vitest unit/component tests
- `npm run test:e2e` — playwright
- `npm run lint`

## What this project is
PlanReader: a free, no-signup web tool that explains raw database execution plans
(Postgres, SQL Server, Snowflake) in plain English with an interactive node-graph
visualization. Full context in `docs/03-prd-v1.md` and `docs/04-technical-spec-v1.md`.

## Architecture summary
Three engine-specific parsers (`src/parsers/postgres`, `src/parsers/sqlserver`,
`src/parsers/snowflake`) compile to a shared `PlanNode` model (`src/parsers/normalize.ts`).
A rule engine (`src/rules/`) operates on `PlanNode`, producing `Warning[]`.
Graph rendering and all interactivity (`src/graph/`) is React Flow + dagre.

**The rule-based path is 100% client-side. No network calls may be added to
`src/parsers/`, `src/rules/`, or `src/graph/` without an explicit architecture
discussion first.**

## Relevant skills (also readable directly — same content as Claude Code's skills)
- `.claude/skills/postgres-plan-parsing/` — `src/parsers/postgres/`
- `.claude/skills/sqlserver-plan-parsing/` — `src/parsers/sqlserver/`
- `.claude/skills/snowflake-plan-parsing/` — `src/parsers/snowflake/`
- `.claude/skills/plan-normalization/` — `src/parsers/normalize.ts`, operator mapping tables
- `.claude/skills/rule-engine-authoring/` — `src/rules/`
- `.claude/skills/graph-visualization/` — `src/graph/`
- `.claude/skills/operator-glossary-content/` — `src/graph/glossary/` (plain-language operator definitions)
- `.claude/skills/privacy-architecture/` — any network call, logging, or error-handling change, anywhere

## Review guidelines
When reviewing a PR in this repository:
- Flag any change to `src/parsers/` or `src/rules/` that lacks a corresponding
  fixture in `fixtures/` or a unit test.
- Flag any new network call anywhere in `src/parsers/`, `src/rules/`, or `src/graph/`
  as a P0 issue — the rule-based path must stay 100% client-side.
- Flag any error message or logging statement that could include raw pasted plan
  content (table/column names, filter values, literal query text).
- Flag any change to a `Warning`-producing rule that adds a positive-case test
  without a corresponding negative-case test (a rule that only proves it *can*
  fire, not that it doesn't misfire, is incompletely tested).
- Confirm the LLM narrative mode's opt-in default is not flipped to "on" by any change.
- Flag any glossary entry (`src/graph/glossary/`) that references a specific plan's numbers or "this node" rather than staying general — that content belongs in a rule's `Warning` text, not the glossary (see `operator-glossary-content` skill).

## Conventions
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`)
- One branch/PR per story from `docs/08-episodes-and-stories.md`

## Current focus
Before continuing with `docs/08-episodes-and-stories.md`, work through `docs/11-manual-testing-gaps-episode8.md` — 4 gaps found in manual testing after Episode 8. Two have a confirmed root cause (file/line pointers included); the other two need the real plan XML from manual testing reproduced as a fixture before any fix is written — don't guess at a fix for those without reproducing first.

## Full doc index
See `CLAUDE.md` for the complete list — same docs, same paths.
