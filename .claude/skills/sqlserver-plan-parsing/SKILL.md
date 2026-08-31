# Skill: SQL Server Plan Parsing

**Use this skill whenever writing, reviewing, or debugging code in `src/parsers/sqlserver/`** — anything that converts Showplan XML (`.sqlplan` file or pasted XML) into a `PlanNode` tree.

## Source of truth

Full requirements: `docs/technical-spec.md` §1.2, `docs/episodes.md` Episode 2. If this skill and those docs disagree, the docs win and this file should be updated.

## Non-negotiable rules

1. **Never assume `ShowPlanXML` is the document root.** Extended Events capture (a very common export method) wraps `ShowPlanXML` inside additional XML. Search the parsed document for the `ShowPlanXML` element wherever it appears rather than reading from the root node. Write a fixture specifically for the Extended-Events-wrapped case and keep it in the test suite permanently — this is a routine input shape, not a rare one.
2. **Handle both namespace declaration styles.** Real-world exports use both `xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"` (default namespace) and `xmlns:p="..."` (prefixed). The XML parsing must be namespace-aware and tolerate both — do not hardcode a prefix assumption.
3. **Support both file upload and pasted text as input paths into the same parser.** Users get `.sqlplan` files from SSMS/Plan Explorer and also copy-paste raw XML text — both must resolve to identical parsing behavior.
4. **A single paste may contain multiple `Statement` elements** (a `.sqlplan` capture spanning a batch). Detect this and either let the user select which statement to visualize or represent both — never silently parse only the first and discard the rest without telling the user.

## Structural handling

- Build the operator tree from `RelOp` elements, mapping `PhysicalOp`, `LogicalOp`, `EstimateRows`, `EstimateIO`, `EstimateCPU`, `AvgRowSize`, `EstimatedTotalSubtreeCost` into normalized fields (see `plan-normalization` skill for the mapping table pattern).
- `RunTimeInformation` / `RunTimeCountersPerThread` may be absent (estimated-plan-only capture) — treat as optional, same pattern as Postgres's missing-`ANALYZE` case. Never throw on its absence.
- Parallelism operators (`Parallelism`, `Gather Streams`) carry per-thread stat blocks. Preserve per-thread data rather than only a summed figure, and label any aggregated display explicitly (e.g. "across N threads") — mirrors the parallel-worker labeling requirement on the Postgres side.
- Missing-index recommendation blocks are frequently present in real exports and are useful, actionable information — surface them as a distinct, clearly labeled section of the parsed output rather than dropping them because they're outside the core `RelOp` tree.
- `RunTimeCountersPerThread`'s `ActualReadAheads` is a distinct statistic from `ActualPhysicalReads` — SQL Server's own deliberate sequential-prefetch mechanism, not a buffer-pool miss. Sum it across threads into `io.readAheads` (same `sumThreadAttr` pattern as `logicalReads`/`physicalReads`), never fold it into `bufferReads` itself — the rule engine (`bufferCacheInefficiency.ts`) needs the two counts separately to exclude read-ahead pages before judging cache-hit ratio (docs/10-node-stats-field-catalog.md §5).

## Operator mapping

Maintain a documented `PhysicalOp -> normalized operatorType` table (see `plan-normalization/SKILL.md`). Anything not yet mapped must resolve to an explicit `unknown` type with the raw `PhysicalOp` label preserved — never throw or silently drop an unrecognized operator.

## Testing checklist for any change in this directory

- [ ] Fixture added/updated in `fixtures/sqlserver/`, named after the case (e.g. `extended-events-wrapped.xml`, `multi-statement-batch.sqlplan`, `default-namespace.xml`, `prefixed-namespace.xml`).
- [ ] Unit test confirms `ShowPlanXML` is located correctly regardless of wrapping.
- [ ] Unit test confirms both namespace declaration styles parse identically.
- [ ] Unit test confirms multi-statement input is detected and handled per the product decision (selectable/all-shown), not silently truncated.
- [ ] Malformed/truncated XML produces a specific, structural error message — not a generic crash, and never includes the raw offending XML content in a logged error (see `privacy-architecture` skill).
- [ ] `ActualReadAheads` promotes to `io.readAheads`, kept separate from `io.bufferReads` (`ActualPhysicalReads`) — see `fixtures/sqlserver/read-ahead-heavy-scan.xml`.
