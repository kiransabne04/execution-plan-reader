# PlanReader — Local Development Setup Guide

## 1. Repo scaffolding

```bash
mkdir planreader && cd planreader
npm create vite@latest . -- --template react-ts
git init
```

Add the core dependencies from the Technical Spec's recommended stack:

```bash
npm install @xyflow/react @dagrejs/dagre
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test    # e2e / interaction testing
npx playwright install
```

Suggested top-level structure, mapping directly to the episodes in `08-episodes-and-stories.md`:

```
src/
  parsers/
    postgres/        # Episode 1 — JSON + TEXT parsers, cleanup pass
    sqlserver/        # Episode 2 — Showplan XML parser
    snowflake/        # Episode 3 — operator-stats parser
    normalize.ts      # Episode 4 — PlanNode model + operator taxonomy
  rules/               # Episode 5 — rule engine, one file per rule
  graph/               # Episode 6 — React Flow + dagre rendering, interactive UI
  privacy/             # Episode 7 — network-call guarding, error scrubbing
  fixtures/            # Real-world plan samples, organized by engine and scenario
  __tests__/
docs/
  prd.md               # copy of 03-prd-v1.md, kept in-repo so it stays close to code
  technical-spec.md
  episodes.md
CLAUDE.md
AGENTS.md
```

Copying the PRD, Tech Spec, and Episodes docs into `docs/` (not just keeping them in Claude) matters — it's what lets both Claude Code and Codex read them as project context automatically, rather than you re-explaining scope in every session.

## 2. Git branching and commit conventions

A lightweight trunk-based flow fits this project's size well:

- `main` — always deployable, protected (no direct pushes once you add a remote/CI).
- One branch per story, named after the episode/story it implements, e.g. `feat/1.1-postgres-json-parser`, `feat/6.1-node-graph-render`, `fix/2.1-showplan-root-detection`.
- Commit using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`) — both Claude Code and Codex read commit history for context, and consistent prefixes make that context more useful, plus it sets you up for auto-generated changelogs later.
- Commit at natural checkpoints (a passing test, a working parser for one plan shape) rather than one giant commit per story — this gives you real rollback points, which matters more when an AI agent is doing a chunk of the typing.
- Open a PR per story even if you're the only reviewer; it's a natural place for Codex's automated PR review (see §4) to run, and for Claude Code to summarize a diff before you merge.

## 3. Testing setup

Matches the testing approach specified per-story in the Episodes doc:

- **Unit tests** (Vitest): parsers, normalization, and rule engine — the majority of the test suite, since these are pure functions operating on data.
- **Component/interaction tests** (Testing Library): search/filter behavior, expand/collapse state, keyboard navigation — anything with UI state.
- **Visual/e2e tests** (Playwright): full paste → parse → visualize → warnings flow per engine, plus the network-call-guarding privacy test from Episode 7 (assert zero outbound requests containing plan content during the default flow).
- **Fixture library**: build this early and treat it as a first-class asset, not test scaffolding — it's referenced by nearly every story in the Episodes doc. Organize fixtures by engine, then by scenario (`fixtures/postgres/parallel-worker-cumulated-timing.json`, `fixtures/sqlserver/extended-events-wrapped.xml`, etc.), naming each after the edge case it covers so the fixture library doubles as living documentation of what's been handled.

```bash
npm run test          # vitest unit/component tests
npm run test:e2e       # playwright
```

## 4. Connecting Claude Code

Claude Code is Anthropic's terminal-native coding agent — it reads your repo directly rather than working from copy-pasted context.

**Install** (macOS/Linux):
```bash
curl -fsSL https://claude.ai/install.sh | bash
claude doctor        # verify install/auth
```
On Windows: `irm https://claude.ai/install.ps1 | iex`. Claude Code is included with Claude Pro/Max subscription auth (sign-in based), or billed per-token via `ANTHROPIC_API_KEY` for headless/CI use.

**Set up project context**: run `claude` from the repo root, then `/init` — it scans the codebase and drafts a starting `CLAUDE.md`. Edit it down to the essentials (this file is re-read every session, so keep it lean — under ~150–200 lines):

```markdown
## Commands
- `npm run dev` — start dev server
- `npm test` — vitest
- `npm run test:e2e` — playwright
- `npm run lint`

## Architecture
- See docs/technical-spec.md for the full architecture; summary:
  Three engine-specific parsers (parsers/postgres, parsers/sqlserver,
  parsers/snowflake) compile to a shared PlanNode model (parsers/normalize.ts).
  Rule engine (rules/) operates on PlanNode, produces Warning[].
  Graph rendering (graph/) is React Flow + dagre.
  Rule-based path is 100% client-side — no network calls may be added
  to this path without an explicit architecture discussion first.

## Conventions
- Conventional Commits (feat/fix/test/docs/refactor)
- Every parser change needs a corresponding fixture in fixtures/
- Never log or include raw pasted plan content in error messages (see docs/prd.md §privacy)

## Current focus
- See docs/episodes.md — work through episodes in order, one story at a time
```

Use Claude Code well by pointing it at specific stories: `claude "implement story 1.1 from docs/episodes.md — the Postgres JSON parser, including the duplicate-key-tolerant parsing edge case"` gets a far better result than a vague "build the Postgres parser" prompt, because the story already has acceptance criteria and an edge-case table it can work against and self-check. For anything touching the privacy architecture (Episode 7), explicitly ask it to run the network-call-guarding test after the change, not just write the code.

## 5. Connecting Codex (OpenAI)

Codex is OpenAI's coding agent, available as a CLI, a VS Code/Cursor/Windsurf IDE extension, and cloud tasks that run asynchronously and open PRs.

**Install the CLI** and authenticate with a ChatGPT account or API key (see OpenAI's current Codex docs for the exact install command, since this has changed formats a few times — search "Codex CLI install" if the below is stale by the time you set this up):
```bash
npm install -g @openai/codex   # or the current install method per OpenAI's docs
codex login
```

**Set up project context**: Codex reads `AGENTS.md` (an open-standard file, also read by Cursor, Windsurf, Gemini CLI, and others) the same way Claude Code reads `CLAUDE.md`. You can largely mirror the content — same commands, same architecture summary, same conventions — since both files serve the same purpose for different tools:

```markdown
# AGENTS.md
(same content structure as CLAUDE.md above — commands, architecture, conventions)

## Review guidelines
- Flag any change to parsers/ or rules/ that lacks a corresponding fixture or unit test.
- Flag any new network call anywhere in the rule-based path (graph/, rules/, parsers/) as a P0 issue.
```

**A practical split, rather than running both agents on everything**: since you have both tools available, a reasonable division of labor is Claude Code for the substantive implementation work (parsers, rule engine, interactive graph features — the stuff with real design judgment and edge cases from the Episodes doc) and Codex's GitHub PR review integration as an automated second pair of eyes on every PR, particularly enforcing the two things that matter most here: test/fixture coverage and the privacy-architecture boundary (no network calls sneaking into the rule-based path). Codex's cloud tasks are also a reasonable place to park a self-contained, well-specified story (e.g. "implement Story 8.1's meta tags and schema.org markup exactly as specified in docs/prd.md") that doesn't need much back-and-forth, letting it run in the background while you keep working with Claude Code on something else.

## 6. Suggested build order (maps directly onto the Episodes doc)

1. Scaffold repo, fixture library skeleton, CI (lint + unit tests on every PR).
2. Episode 1 (Postgres ingestion) end-to-end, including the parsing-robustness edge cases — this is the best-understood format and validates the whole pipeline (parser → normalize → rule engine → graph) before you multiply it across two more engines.
3. Episode 4 (normalization layer) solidified once Postgres proves the model, before starting Episode 2/3 — cheaper to adjust the shared model against one engine than to retrofit it after three.
4. Episode 2 (SQL Server) and Episode 3 (Snowflake) ingestion, in either order — both exercise and harden the normalization layer from a different angle.
5. Episode 5 (rule engine) grown alongside ingestion work rather than after it — write the first few rules against Postgres fixtures early, since waiting until all three parsers are "done" delays the point where you're validating the thing that actually delivers the product's core value.
6. Episode 6 (visualization + interactive UI) — buildable in parallel with the above once the `PlanNode` model is stable, since it only depends on that shared shape, not on any single engine's parser being finished.
7. Episode 7 (privacy architecture) verified continuously from the start (the network-call-guarding test should exist and pass from very early on), not bolted on right before launch.
8. Episode 8–9 (landing page, funnel touchpoints) once the core tool is functional enough to actually demo.
9. Episode 12 (soft launch) — link quietly from the existing blog/video content, fix what real-world plans break, then move to community launch per the Content & Launch Plan's sequencing.
