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

## OPERATOR_STATISTICS's real shape (verified Episode 33, against Snowflake's own GET_QUERY_OPERATOR_STATS function reference — docs.snowflake.com — not assumed from memory)

The `statistics`/`operator_statistics` object on a row is **flat at the top level, by category** — `io`, `pruning`, `spilling`, `network`, `search_optimization`, and `dml` are all SIBLING objects, none nested inside another:

```
{
  "input_rows": ..., "output_rows": ...,
  "io": { "scan_progress", "bytes_scanned", "percentage_scanned_from_cache",
           "bytes_written", "bytes_written_to_result", "bytes_read_from_result",
           "external_bytes_scanned" },
  "pruning": { "partitions_scanned", "partitions_total", "partitions_pruned_by_snowflake_optima" },
  "spilling": { "bytes_spilled_local_storage", "bytes_spilled_remote_storage" },
  "network": { "network_bytes" },
  "search_optimization": { "partitions_pruned_by_search_optimization",
                             "partitions_pruned_by_search_optimization_and_snowflake_optima" },
  "dml": { "number_of_rows_inserted", "number_of_rows_updated",
            "number_of_rows_deleted", "number_of_rows_unloaded" }
}
```

**This parser got two of these nestings wrong from Episode 3 through Episode 32** (fixed in Episode 33 — see `docs/08-episodes-and-stories.md` Episode 33 for the full story-by-story account):
- `deriveSpill()` read `bytes_spilled_to_local_storage`/`bytes_spilled_to_remote_storage` from inside `statistics.io` — wrong container (`spilling`, not `io`) AND wrong field names (no `_to_`). A real plan's spill would have silently never been detected.
- `derivePruning()` read `partitions_assigned` from `row.attributes` — wrong container (`statistics.pruning`, not `attributes`) AND a field name (`partitions_assigned`) that doesn't exist in Snowflake's real schema at all (the real field is `partitions_scanned`). `pruning.partitionsScanned` would have come back `undefined` for every real Snowflake export, on every TableScan, ever.

`input_rows` (a real top-level statistic, sibling to `output_rows`) is now captured as `PlanNode.inputRows` — deliberately deferred by Episode 33 itself (to avoid an unrequested behavior change to every rule already built on the "derive from children" technique), then explicitly captured in a later addendum. Every rule that used to derive "input rows" by summing/maxing children's own `actualRows` (`explodingJoin.ts`, and the Episode 32/34 rules built on its technique) now goes through `inputRowsDetail.ts`'s shared `resolveInputRows()`, which prefers the real field and falls back to the children-derivation only when it's absent. When adding a new rule that needs "how many rows entered this operator," use `resolveInputRows()` — don't re-derive it a third, differently-worded way.

## Structural handling

- Spill/pruning/network/search-optimization/DML stats each live under their own top-level statistics key (see shape above) and are easy to nest wrong — the parser should promote each to a normalized, easily-checkable field (not buried in the raw `attributes`/`statistics` bag only) since these are first-class rule-engine signals (see `rule-engine-authoring` skill).
- High-partition-count `TableScan` operators (tens of thousands of partitions on large real tables) are common — don't assume small numbers in fixtures represent production scale.
- Users may paste this data in slightly non-standard shapes (e.g. a result-grid export with extra column headers, since getting this JSON out of Snowflake requires running a function and copying output, not a UI "copy plan" button). Build tolerant parsing for near-miss formats where practical, and always give a specific, helpful error rather than a generic parse failure — point users toward the correct way to run `GET_QUERY_OPERATOR_STATS()` in the error message.
- **Corrected claim (Episode 33)**: this skill previously claimed Snowflake's "percentage scanned from cache" statistic was **only** available from `QUERY_HISTORY`/the Query Profile summary, not from `GET_QUERY_OPERATOR_STATS()`. That claim was wrong — it's `io.percentage_scanned_from_cache`, present per-operator in the exact input format this parser already accepts, and is now captured on `IoInfo.percentageScannedFromCache`. Left here as a record of the correction, so a future contributor doesn't reintroduce the same wrong assumption from an old comment elsewhere.
- `STEP_ID` (the row's own step/stage grouping, shown as separate tabs in the Query Profile UI) is a real column on `GET_QUERY_OPERATOR_STATS()`'s result set — preserve it (`PlanNode.stepId`) rather than discarding it during row parsing.
- DML operator nodes (`Insert`/`Update`/`Delete`/`Merge`/`Unload`) carry their own `dml` statistics object — map these operator names in `operatorMap.ts` (they have no honest read-only-query equivalent to reuse) and give them real operator-glossary entries (`operator-glossary-content` skill), not just a raw fallback.

## Testing checklist for any change in this directory

- [ ] Fixture added/updated in `fixtures/snowflake/`, named after the case (e.g. `multi-parent-with-clause.json`, `redacted-query-text.json`, `spill-to-remote-disk.json`).
- [ ] Unit test: multi-parent operator reconstructs correctly without infinite loop or dropped edges.
- [ ] Unit test: every operator type in the fixture library resolves to a known normalized type or the explicit `unknown` fallback.
- [ ] Round-trip test: given a synthetic operator list with known IDs/parent references, assert the reconstructed tree has exactly the expected shape.
- [ ] Redacted-query-text fixture confirms clean, non-crashing handling.
