# PlanReader — repo skeleton

This is a starting skeleton, not a scaffolded app yet. It contains:

- `docs/` — the full PRD, Technical Spec, MoSCoW prioritization, competitive analysis,
  additional-limitations research, episodes/user-stories backlog, and local dev setup guide.
- `.claude/skills/` — seven repo-scoped Claude Code skills, one per major subsystem
  (Postgres/SQL Server/Snowflake parsing, normalization, rule engine, graph visualization,
  privacy architecture). These are also readable by any other tool that follows the
  Agent Skills open standard.
- `CLAUDE.md` — project context for Claude Code (read automatically every session).
- `AGENTS.md` — project context for Codex and other AGENTS.md-compatible tools
  (Cursor, Windsurf, Gemini CLI).

## To actually scaffold the app

This skeleton does not yet include `package.json`, `src/`, or build tooling.
Follow `docs/09-local-dev-setup.md` §1 to run the Vite scaffold and install
dependencies, then start with Episode 1 in `docs/08-episodes-and-stories.md`.

```bash
npm create vite@latest . -- --template react-ts
npm install @xyflow/react @dagrejs/dagre
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @playwright/test
```

## Skills are repo-scoped, not global

The `.claude/skills/` directory here is **project-scoped**: it travels with this repo
via git, and only applies when Claude Code is working inside it — unlike Claude.ai's
account-level Skills feature (Settings → Customize → Skills), which is the same set
across every chat/Project you have and can't be restricted to just this codebase.
Anyone who clones this repo and runs Claude Code gets the same skills automatically.
