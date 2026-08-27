# Story Template

Copy this shape into `docs/08-episodes-and-stories.md` under the relevant Episode (or a new Episode heading, if the work doesn't fit an existing one — add the new Episode heading following the same `## Episode N — Name` pattern as the others). Every story in the doc follows this exact structure; agents are told to expect it, so deviating from it (skipping the edge-case table, vague acceptance criteria) genuinely degrades how well Claude Code or Codex can work from it.

```markdown
### Story N.M — <short, specific title>

As a <persona from docs/03-prd-v1.md>, I want <thing>, so that <reason>.

**Acceptance criteria**
- <specific, verifiable condition>
- <specific, verifiable condition>

**Testing approach**
- <unit/component/e2e — what kind of test, and roughly what it checks>
- <if this story touches an existing testing pattern from another story, name it explicitly>

**Edge cases to handle**
| Case | Why it matters | Handling |
|---|---|---|
| <specific scenario> | <why a naive implementation would get this wrong> | <what the correct behavior is> |
```

## Rules for writing a good story

1. **One persona, one clear want, one clear reason** — if you can't fill in the "As a / I want / so that" cleanly, the story is probably still two stories, or not yet well-defined enough to hand to an agent.
2. **Acceptance criteria must be checkable**, not aspirational. "The panel looks nice" is not checkable; "estimate-vs-actual mismatch renders as a border/badge, not color alone" is.
3. **The edge-case table is not optional padding** — it's the actual spec for what a thorough implementation looks like. If you can't think of edge cases, that's a signal to look at `07-additional-tool-limitations.md` and the relevant `*-plan-parsing`/`rule-engine-authoring`/`graph-visualization` skill for the kind of real-world failure mode that category of work tends to have, rather than shipping the story without one.
4. **Cross-reference, don't duplicate.** If the story depends on a decision already documented elsewhere (the field catalog, a skill's rule), link to it by filename rather than re-explaining it — that's what keeps `docs/11-memory-map-and-context.md`'s "decisions worth remembering" section from getting silently contradicted by a story that re-derives the same thing slightly differently.
5. **New engine-specific fields or behaviors** belong in `10-node-stats-field-catalog.md` and the relevant skill file, not just inline in the story — the story references them, it doesn't own that content.

## After adding the story

1. Add a row for it in `docs/BACKLOG-STATUS.md` (status: `not started`).
2. That's it — you do **not** need to edit `CLAUDE.md` or `AGENTS.md` per new story. Both point at `BACKLOG-STATUS.md` as the current-work source of truth rather than hardcoding which episode/story is "next," specifically so this step scales without constant root-file churn.

## Prompting Claude Code / Codex to work on it

```
Implement Story N.M from docs/08-episodes-and-stories.md. Read the relevant
skill(s) first (see docs/11-memory-map-and-context.md's skills index if unsure
which). List the edge-case table as a checklist with a fixture+test next to
each row before you're done. Update docs/BACKLOG-STATUS.md's row for this
story to "in progress" when you start and "done — see PR #<n>" when finished.
```
