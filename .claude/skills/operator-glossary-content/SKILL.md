# Skill: Operator Glossary Content

**Use this skill whenever writing, reviewing, or debugging content in `src/graph/glossary/`** — the plain-language, per-`operatorType` definitions that back the node detail panel's "What this does" / "In general" sections.

## Source of truth

Full requirements: `docs/04-technical-spec-v1.md` §3.2, `docs/08-episodes-and-stories.md` Episode 6 Story 6.2. If this skill and those docs disagree, the docs win and this file should be updated.

## What this is, and what it deliberately is not

A glossary entry is **general, static, engine-and-plan-independent education about an operator type** — "what a Hash Join is," not "what's wrong with the Hash Join on line 3 of your plan." That second thing is a `Warning` (see `rule-engine-authoring` skill). The two must never blur together:

- A glossary entry must never mention a specific plan's numbers, a specific table/column name, or phrases like "this node" / "here" / "in your plan."
- A `Warning`'s `shortText`/`longText` must never be duplicated into a glossary entry, and vice versa — reusing content across the two is exactly the false-confidence failure mode the parameter-sensitivity honesty note already guards against elsewhere (a general fact read as a specific diagnosis, or a specific diagnosis read as if it always applies).

This is the same discipline the detail panel's own spec (Story 6.2, sections 4 vs. 5) calls out explicitly — if you're ever unsure which bucket a sentence belongs in, ask: "would this sentence be true and useful for someone who has never seen this specific plan?" If yes, glossary. If no, `Warning`.

## Data model

```ts
interface OperatorGlossaryEntry {
  operatorType: string        // matches the normalized taxonomy (plan-normalization skill) — the map key
  displayName: string          // "Sequential Scan", not the raw engine label
  shortDefinition: string      // 1-2 sentences — Expert mode's collapsed-to-one-line education (Episode 18, Story 18.7; spec-driven reversal of this field's original Story 6.2 role)
  longDefinition: string       // fuller paragraph — Beginner mode's "What this does" text (Story 18.7)
  whenItsFine: string          // general "this is often the right choice when..."
  whenToLookCloser: string     // general "this is worth a second look when..."
  learnMoreUrl?: string        // link into existing @scalingbackend content, when available
}
```

Every field except `learnMoreUrl` is required — a partially-written entry (e.g. missing `whenItsFine`) is worse than no entry at all, since the fallback state (below) is an honest "we don't have this yet," while a half-filled entry looks finished but isn't.

## Coverage strategy

1. Author entries for the highest-frequency operator types first: scans, all join types, sort, aggregate, filter, limit — roughly the set the MVP rule engine (Episode 5) already covers.
2. Expand using the same "seen but unmapped" tracking discipline as the operator-mapping tables (`plan-normalization` skill): an `operatorType` showing up in real fixture or soft-launch traffic without a glossary entry is a tracked content gap, not something to silently absorb.
3. `operatorType: "unknown"` (the normalization layer's own explicit fallback) is never given a glossary entry — it renders the raw label plus the standard "we don't have a detailed explanation for this operator yet" fallback state, same as any other uncovered type.

## Authoring approach

This is credibility-bearing content. It's reasonable to draft entries quickly with LLM assistance for a first pass, but **each entry needs a real review pass against working DBA knowledge before it ships** — the same discipline the MVP rule set gets in Episode 5's testing approach. Getting an operator's plain-language definition subtly wrong is a worse outcome than not having an entry yet: the fallback state is honest, a confidently wrong definition isn't. Treat any newly-authored batch of entries as a draft pending that review, not as done.

## Testing checklist for any change in this directory

- [ ] Coverage test: every `operatorType` appearing anywhere in the fixture library resolves to a real glossary entry or the explicit fallback state — suite-wide, same pattern as the normalization layer's taxonomy sweep.
- [ ] No entry's text references a specific plan's numbers, a specific table/column name, or "this node"/"here" — that content belongs in a `Warning`, not here.
- [ ] Every required field is non-empty for every entry (a missing field is a bug, not an acceptable partial entry).
- [ ] `operatorType: "unknown"` is never given an entry — it must go through the fallback path, not a fabricated one.
- [ ] New entries are flagged as pending a DBA review pass, not presented as final, until that review actually happens.
