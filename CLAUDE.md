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
discussion first — see `.claude/skills/privacy-architecture/SKILL.md`.**

## Relevant skills (read before touching the matching directory)
- `.claude/skills/postgres-plan-parsing/` — `src/parsers/postgres/`
- `.claude/skills/sqlserver-plan-parsing/` — `src/parsers/sqlserver/`
- `.claude/skills/snowflake-plan-parsing/` — `src/parsers/snowflake/`
- `.claude/skills/plan-normalization/` — `src/parsers/normalize.ts`, operator mapping tables
- `.claude/skills/rule-engine-authoring/` — `src/rules/`
- `.claude/skills/graph-visualization/` — `src/graph/`
- `.claude/skills/privacy-architecture/` — any network call, logging, or error-handling change, anywhere

## Conventions
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`)
- Every parser or rule change needs a corresponding fixture in `fixtures/`
- Never log or include raw pasted plan content in an error message (see privacy-architecture skill)
- One branch per story, named after the episode/story it implements
  (e.g. `feat/1.1-postgres-json-parser`)

## Current focus
Work through `docs/08-episodes-and-stories.md` in order, one story at a time.
Each story has acceptance criteria, a testing approach, and an edge-case table —
treat the edge-case table as a checklist, not optional background reading.

## Full doc index
- `docs/01-competitive-analysis.md`
- `docs/02-feature-prioritization-moscow.md`
- `docs/03-prd-v1.md`
- `docs/04-technical-spec-v1.md`
- `docs/05-landing-page-positioning.md`
- `docs/06-content-launch-plan.md`
- `docs/07-additional-tool-limitations.md` — real-world evidence behind many edge cases
- `docs/08-episodes-and-stories.md` — the buildable backlog
- `docs/09-local-dev-setup.md`
