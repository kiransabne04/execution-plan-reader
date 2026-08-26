# Skill: Postgres Plan Parsing

**Use this skill whenever writing, reviewing, or debugging code in `src/parsers/postgres/`** — anything that converts raw `EXPLAIN` output (TEXT or JSON) into a `PlanNode` tree.

## Source of truth

Full requirements: `docs/technical-spec.md` §1.1, `docs/episodes.md` Episode 1. This skill is a condensed, code-facing companion to those — if they conflict, the docs win and this file should be updated to match.

## Non-negotiable rules

1. **Never use the browser's native `JSON.parse()` on Postgres plan JSON.** Postgres has shipped plans with duplicate keys (e.g. two `"Workers"` blocks on one node) — `JSON.parse()` silently keeps only one and drops the other with no error. Use a duplicate-key-tolerant/stream parser (e.g. a `reviver`-based approach that merges duplicate keys into an array, or a proper streaming JSON parser) so no data is silently lost.
2. **Run the cleanup pass before the structural parser, always.** Real-world pastes routinely include:
   - `psql \x on` artifacts: `[ RECORD ]` markers and a `QUERY_PLAN` header line.
   - `auto_explain` log capture: leading `LOG:` / timestamp prefixes, surrounding log noise.
   - Mixed line endings (CRLF from Windows-authored pastes).
   - Leading/trailing whitespace and blank lines.
   Strip all of these in a dedicated `cleanup(rawInput: string): string` function, unit-tested independently of the structural parser, before any tree-building logic runs.
3. **TEXT and JSON parsers must produce structurally equivalent trees for the same query.** Write parity tests: run a query through both `FORMAT JSON` and plain TEXT, assert equivalent `PlanNode` shape and field values (within floating-point tolerance for timing).
4. **`ANALYZE`-less plans are valid input, not errors.** Estimate-only plans lack `Actual *` fields entirely — the parser must produce a valid `PlanNode` with `actualTimeMs`/`actualRows` simply absent (`undefined`, not `0`, not `NaN`), never throw.

## Known-quirk suppressions (do not "fix" these as bugs)

- `BitmapAnd` / `BitmapOr` nodes **always** report `actual rows = 0` — this is a genuine Postgres behavior, not a parse error and not a real problem. Don't let a mismatch-detection rule fire on these node types (that's a rule-engine concern, but the parser should tag these node types clearly enough that the rule engine can special-case them).
- Cumulated I/O/timing figures across parallel workers can look far worse than reality (a query can display ~5–10x slower than it ran because per-worker times are summed). The parser should preserve per-worker data (`Workers` array) rather than only the summed top-level figure, so downstream code (rule engine, UI) can label this correctly instead of presenting a misleading raw sum.

## Structural handling

- `CTE Scan` nodes reference a shared subtree — do not deep-copy the referenced CTE's subtree into every scan site; represent it once and link additional occurrences. Deep-copying silently double-counts cost in any aggregate rollup.
- `InitPlan` / `SubPlan` nodes are not part of the main top-to-bottom execution flow — tag them distinctly in the `PlanNode` model (e.g. a `planType: "main" | "init" | "sub"` field) so the graph layer (see `graph-visualization` skill) can render them off the primary path rather than inline.
- Very deep/wide plans (100+ nodes) are real — don't assume test fixtures represent the upper bound of what production input looks like.

## Testing checklist for any change in this directory

- [ ] Fixture added/updated in `fixtures/postgres/` for the specific case being fixed, named after the edge case (e.g. `duplicate-workers-key.json`, `psql-record-mode.txt`, `auto-explain-log-capture.txt`).
- [ ] Unit test asserts the parser does not throw on the new fixture.
- [ ] Unit test asserts no silent data loss (specifically re: duplicate keys).
- [ ] If touching TEXT parsing, a parity test against the equivalent JSON fixture.
- [ ] Golden-file snapshot updated deliberately, not just re-generated to make a failing test pass — a snapshot diff should be read and understood before accepting it.

## Common mistake to avoid

Do not build the parser around a single "happy path" real plan and generalize from there. Every rule above exists because a specific, documented real-world failure was found in an existing tool's issue tracker (see `docs/07-additional-tool-limitations.md`). Treat that document as a checklist, not background reading.
