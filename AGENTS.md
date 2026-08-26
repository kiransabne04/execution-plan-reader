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

## Conventions
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`)
- One branch/PR per story from `docs/08-episodes-and-stories.md`

## Full doc index
See `CLAUDE.md` for the complete list — same docs, same paths.
