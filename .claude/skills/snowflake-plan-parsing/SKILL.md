# Skill: Snowflake Plan Parsing

**Use this skill whenever writing, reviewing, or debugging code in `src/parsers/snowflake/`** — anything that converts `GET_QUERY_OPERATOR_STATS()` output (or exported Query Profile JSON) into a `PlanNode` tree.

## Source of truth

Full requirements: `docs/technical-spec.md` §1.3, `docs/episodes.md` Episode 3. If this skill and those docs disagree, the docs win and this file should be updated.

## The core challenge: this input is not a tree

Unlike Postgres (nested JSON) or SQL Server (nested XML `RelOp` elements), Snowflake's operator-stats output is a **flat list of rows with ID-based parent references** (`id`, `parentOperators` or `parent`). Tree reconstruction is a distinct, testable step — do not conflate "parsing the JSON/table" with "building the tree"; keep them as separate functions (`parseRawRows -> OperatorRow[]` then `buildTree(OperatorRow[]) -> PlanNode`).

## Non-negotiable rules

1. **Handle multi-parent operators.** `WithClause`/`WithReference` (CTE-related operators) can have more than one entry in `parentOperators` (Snowflake's own docs show examples like `parentOperators: [3, 8]`). This is not a strict tree — it's closer to a DAG. `buildTree` must not assume single-parent and must not infinite-loop or silently drop a reference when an operator has multiple parents. Represent shared references explicitly (link, don't duplicate) — same principle as CTE handling in the Postgres parser.
2. **Per-operator-type attribute schemas differ entirely.** A `Filter`'s `OPERATOR_ATTRIBUTES` bear no resemblance to a `TableScan`'s or an `ExternalFunction`'s. Maintain a per-operator-type mapping (see `plan-normalization` skill), with an explicit fallback that still renders raw attributes for any operator type not yet mapped — never drop attributes just because the type is unrecognized.
3. **Preserve the full execution-time breakdown**, not just the aggregate: `overall_percentage`, `initialization`, `processing`, `synchronization`, `local_disk_io`, `remote_disk_io`, `network_communication`. The rule engine needs these individually (e.g. to flag spill specifically) — don't flatten them into a single number during parsing.
4. **Detect and cleanly handle redacted query text.** Organizations with `ENABLE_UNREDACTED_QUERY_SYNTAX_ERROR` off will see `<redacted>` in query text fields for users who don't own the query. Display this as "query text redacted by account policy," not as literal content, and never treat it as if it were real query text for node-to-query correlation (see `graph-visualization` skill).

## Structural handling

- Spill-to-local-disk / spill-to-remote-disk stats are nested inside IO detail objects and easy to overlook — the parser should promote spill presence to a normalized, easily-checkable field (not buried in the raw `attributes` bag only) since it's a first-class rule-engine signal (see `rule-engine-authoring` skill).
- High-partition-count `TableScan` operators (tens of thousands of partitions on large real tables) are common — don't assume small numbers in fixtures represent production scale.
- Users may paste this data in slightly non-standard shapes (e.g. a result-grid export with extra column headers, since getting this JSON out of Snowflake requires running a function and copying output, not a UI "copy plan" button). Build tolerant parsing for near-miss formats where practical, and always give a specific, helpful error rather than a generic parse failure — point users toward the correct way to run `GET_QUERY_OPERATOR_STATS()` in the error message.
- **Known, deliberate gap — not an oversight**: Snowflake's "percentage scanned from cache" statistic is real, but it lives in `QUERY_HISTORY`/the Query Profile summary, a genuinely different data source than `GET_QUERY_OPERATOR_STATS()` — this parser has no way to derive it from the one input format it accepts. Don't add a query-level-cache-hit field to `PlanNode` on the assumption the data is just sitting there unextracted; it isn't, without accepting a second paste from a different source (see docs/10-node-stats-field-catalog.md §5's own note on this). The rule engine's Snowflake I/O signal (`bufferCacheInefficiency.ts`) uses the already-available per-node `timeBreakdown` local/remote-disk-I/O split instead.

## Testing checklist for any change in this directory

- [ ] Fixture added/updated in `fixtures/snowflake/`, named after the case (e.g. `multi-parent-with-clause.json`, `redacted-query-text.json`, `spill-to-remote-disk.json`).
- [ ] Unit test: multi-parent operator reconstructs correctly without infinite loop or dropped edges.
- [ ] Unit test: every operator type in the fixture library resolves to a known normalized type or the explicit `unknown` fallback.
- [ ] Round-trip test: given a synthetic operator list with known IDs/parent references, assert the reconstructed tree has exactly the expected shape.
- [ ] Redacted-query-text fixture confirms clean, non-crashing handling.
