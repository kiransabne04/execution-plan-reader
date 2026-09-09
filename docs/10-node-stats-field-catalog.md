# PlanReader — Node Stats Field Catalog

This is the field-level reference behind the "This node's numbers" section of the rich detail panel (Episodes doc Story 6.2) and the extended `PlanNode` model in the Technical Spec. For each category you asked about — predicates/filters, index name/type, join type, costs, buffers, disk spill, cache reads, time, actual rows — this documents exactly which raw field each engine exposes, what it's called, and how it maps to a normalized field on `PlanNode`. Where an engine simply doesn't expose something the others do, that's stated plainly rather than papered over — the detail panel must degrade honestly per §7 of Story 6.2, and that starts with the data model knowing what's actually available.

## Extended `PlanNode` model

This supersedes the earlier version in `docs/04-technical-spec-v1.md` §1.4 — the core shape is unchanged, but the `attributes` bag now has a set of *promoted, normalized sub-fields* for the categories below, so the detail panel doesn't have to reach into engine-specific raw keys to render its core sections.

```ts
interface PlanNode {
  id: string
  engine: "postgres" | "sqlserver" | "snowflake"
  operatorType: string
  rawOperatorLabel: string
  estimatedRows?: number
  actualRows?: number
  rowsRemovedByFilter?: number
  estimatedCost?: number
  actualTimeMs?: number              // cumulated, as reported by the engine
  actualTimePerExecutionMs?: number  // derived: actualTimeMs / max(loops, 1) — see time section below
  loops?: number

  predicate?: {
    filter?: string          // a WHERE-style residual condition applied after reading a row
    indexCondition?: string  // a condition satisfied by an index seek/range itself, not a post-filter
    joinCondition?: string   // the ON/USING condition for a join operator
  }

  index?: {
    name?: string
    type?: string             // normalized: "btree" | "hash" | "gin" | "gist" | "clustered" | "nonclustered" | "columnstore" | "heap" | "bitmap" | "unknown"
    scanDirection?: string    // where applicable (e.g. Postgres's forward/backward)
  }

  join?: {
    logicalType?: string      // normalized: "inner" | "left_outer" | "right_outer" | "full_outer" | "semi" | "anti" | "cross"
    // algorithm (hash/nested-loop/merge) is already captured by operatorType — not duplicated here
  }

  io?: {
    bufferHits?: number         // pages/blocks served from cache
    bufferReads?: number        // pages/blocks read from disk
    cacheHitRatio?: number      // derived: bufferHits / (bufferHits + bufferReads), where computable
    ioReadTimeMs?: number
    ioWriteTimeMs?: number
    bytesScanned?: number       // Snowflake-specific: io.bytes_scanned
    readAheads?: number         // SQL Server-specific (ActualReadAheads) — deliberate prefetch, not a buffer-pool miss; see §5
    percentageScannedFromCache?: number  // Snowflake-specific: io.percentage_scanned_from_cache (§11, Episode 33)
    externalBytesScanned?: number        // Snowflake-specific: io.external_bytes_scanned (§11)
    bytesWrittenToResult?: number        // Snowflake-specific: io.bytes_written_to_result (§11)
    bytesReadFromResult?: number         // Snowflake-specific: io.bytes_read_from_result (§11)
  }

  spill?: {
    occurred: boolean
    bytesLocal?: number         // Snowflake: spilling.bytes_spilled_local_storage (TOP-LEVEL, not nested in io — see §6)
    bytesRemote?: number        // Snowflake: spilling.bytes_spilled_remote_storage; Postgres/SQL Server don't separate local/remote
    detail?: string             // engine-specific free text (e.g. SQL Server's SpillLevel, sort vs. hash spill)
  }

  pruning?: {                   // Snowflake-specific — no Postgres/SQL Server equivalent. TOP-LEVEL pruning object, not under attributes (see §6)
    partitionsScanned?: number  // pruning.partitions_scanned
    partitionsTotal?: number    // pruning.partitions_total
    partitionsPrunedByOptima?: number  // pruning.partitions_pruned_by_snowflake_optima (§11, Episode 33)
  }

  network?: { bytesSent?: number }  // Snowflake-specific: network.network_bytes (§11, Episode 33)

  searchOptimization?: {            // Snowflake-specific (§11, Episode 33)
    partitionsPrunedBySearchOptimization?: number
    partitionsPrunedBySearchOptimizationAndOptima?: number
  }

  dml?: {                           // Snowflake-specific, DML operator nodes only (§11, Episode 33)
    rowsInserted?: number
    rowsUpdated?: number
    rowsDeleted?: number
    rowsUnloaded?: number
  }

  stepId?: number                   // Snowflake-specific: STEP_ID column (§11, Episode 33)

  parallel?: {
    workersLaunched?: number
    workersPlanned?: number
  }

  children: PlanNode[]
  attributes: Record<string, string | number>   // full untouched raw bag — always preserved
  warnings: Warning[]
}
```

**Design note**: every promoted field above is *optional* — absence is meaningful (this engine/operator doesn't expose this) and must render as an honest "not available for this operator" state in the panel, never a blank space that looks like a bug. This mirrors the estimate-only-plan handling already specified in Story 6.2.

---

## 1. Predicates & filters

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Post-scan filter (residual condition) | `Filter` (string, on Scan/Join nodes) | `Predicate` attribute inside the `RelOp`'s operator-specific element (e.g. `Filter`/`RelOp>Predicate`) | Operator attribute, typically under a `Filter` operator's `OPERATOR_ATTRIBUTES` — condition text, e.g. `filter_condition` (attribute name varies by operator) |
| Index-satisfied condition (not a post-filter — satisfied by the seek/scan itself) | `Index Cond` | `SeekPredicates` (element containing `SeekPredicateNew`/predicate range) | Not applicable — Snowflake's `TableScan` exposes pruning stats (§6) rather than an index-seek-condition concept, since it has no traditional index structure |
| Rows discarded by the filter after being read | `Rows Removed by Filter` | Derivable from `EstimateRows` vs. `RunTimeInformation` actual row counts at that operator, not a single labeled field | Not directly exposed as a discrete field; approximate via row counts on adjacent `Filter`/`TableScan` operators |
| Join condition | `Hash Cond` (hash join) / `Merge Cond` (merge join) / join clause embedded in `Filter` for nested loop | `RelOp` join operator's condition, typically under `HashKeysBuild`/`HashKeysProbe` (hash) or `InnerSideJoinColumns`/`OuterReferences` (nested loop) | Join operator's `equality_join_condition` / `additional_join_condition` attributes |

**Handling note**: `predicate.filter` and `predicate.indexCondition` are kept as separate fields deliberately — conflating "why this row was excluded during the scan itself" with "what was checked afterward" is a common source of confusion the detail panel should actively clarify, not reproduce.

## 2. Index name and type

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Index name | `Index Name` | `Object` element's `Index` attribute (within the `IndexScan`/`IndexSeek` operator) | Not applicable — Snowflake has no user-managed secondary index concept; the closest analog is a search optimization service path, exposed differently (see note below) |
| Index type | Inferable from `Node Type` (`Index Scan` vs `Index Only Scan` vs `Bitmap Index Scan`) combined with the index's underlying access method — Postgres itself doesn't always restate the method (btree/gin/gist/hash) on the plan node; if needed, this requires a supplementary lookup the tool doesn't perform automatically (out of scope — flag as "type not available from the plan alone" rather than guessing) | `Object` element's `IndexKind` attribute: `Clustered`, `NonClustered`, `Heap`, `Columnstore`, etc. — directly available | Not applicable (see above) |
| Scan direction | `Scan Direction` (`Forward`/`Backward`) on relevant scan nodes | Not typically exposed as a discrete field | Not applicable |

**Honest gap**: Postgres's plan output tells you an index was used and its *name*, but not reliably its *underlying type* (btree/gin/gist/hash) without a separate catalog lookup PlanReader doesn't perform (that would require a live database connection, which is explicitly out of scope per the PRD's non-goals). The detail panel should show the index name confidently and state index type as "not determinable from the plan alone" for Postgres rather than guessing from the node type, which is only a weak proxy. SQL Server, by contrast, states `IndexKind` directly — no gap there. Snowflake has no comparable field at all, for architectural reasons (no traditional secondary indexes), and the panel should say so rather than showing an empty index section that looks like missing data.

## 3. Join type (logical) vs. join algorithm

These are two different questions and the field catalog keeps them separate:
- **Algorithm** (hash / nested loop / merge) is already captured by `operatorType` via the normalization layer (`plan-normalization` skill) — no new field needed.
- **Logical type** (inner / left outer / right outer / full outer / semi / anti / cross) is a separate axis, newly promoted to `join.logicalType` above.

| Engine source for logical join type |
|---|
| Postgres: `Join Type` field (`Inner`, `Left`, `Right`, `Full`, `Semi`, `Anti`) directly on join nodes |
| SQL Server: not always a single discrete attribute — inferable from the `LogicalOp` value (e.g. `Left Outer Join`, `Left Semi Join`) on the `RelOp` element, which conflates algorithm and logical type in its label; normalization must split these into `operatorType` (algorithm) and `join.logicalType` (logical type) rather than passing the compound label through unmodified |
| Snowflake: `join_type` attribute on `Join`-family operators (e.g. `INNER`, `LEFT OUTER`) directly available |

## 4. Costs (estimated)

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Startup cost | `Startup Cost` | Not a directly separate field — SQL Server's cost model reports a single `EstimatedTotalSubtreeCost` rather than Postgres's startup/total split | Not exposed as an abstract "cost" unit at all — Snowflake's optimizer doesn't surface a Postgres-style cost number; cost-equivalent signal comes from the execution-time-breakdown and bytes-scanned fields instead (see time and IO sections) |
| Total cost | `Total Cost` | `EstimatedTotalSubtreeCost` | Not applicable, per above |
| Estimated I/O cost | Folded into `Total Cost`, not separately exposed | `EstimateIO` (separate field) | Not applicable — see bytes-scanned instead |
| Estimated CPU cost | Folded into `Total Cost`, not separately exposed | `EstimateCPU` (separate field) | Not applicable |

**Honest gap**: "cost" as an abstract planner-internal unit is a Postgres/SQL Server concept; Snowflake's optimizer doesn't expose an equivalent number at all. The detail panel's cost section should not force a Snowflake node to show a fabricated or zero "cost" — it should show the panel's Snowflake-relevant equivalents (bytes scanned, execution time breakdown, pruning ratio) in that section instead, with a brief note that Snowflake doesn't use a comparable cost-unit model.

## 5. Buffers, cache reads, and I/O

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Cache/buffer hits | `Shared Hit Blocks` (+ `Local Hit Blocks` for temp objects) — requires `BUFFERS` in the `EXPLAIN` call | `RunTimeInformation`'s per-thread `ActualLogicalReads` roughly corresponds (logical reads include buffer-cache hits); SQL Server doesn't cleanly separate "from cache" vs "from disk" the way Postgres's Shared Hit/Read split does | `io.percentage_scanned_from_cache`, a genuine PER-OPERATOR statistic in `GET_QUERY_OPERATOR_STATS()`'s own output (`IoInfo.percentageScannedFromCache` — corrected in Episode 33; see note below) |
| Disk reads | `Shared Read Blocks` (+ `Local Read Blocks`) | `ActualPhysicalReads` (per-thread, in `RunTimeInformation`) | `bytesScanned` (`io.bytes_scanned`) on `TableScan` operators is the closest available signal — not a hit/read split, a total-bytes-read figure. `io.external_bytes_scanned` (Episode 33, `IoInfo.externalBytesScanned`) is the equivalent for reads from an external table/stage, a genuinely different I/O path |
| I/O timing | `I/O Read Time` / `I/O Write Time` — requires `BUFFERS` **and** `track_io_timing = on` at the server level; absent otherwise, and the panel must not imply zero I/O time when the setting simply wasn't enabled | Not typically broken out as a separate timing field distinct from the operator's overall elapsed time | Folded into the operator's `local_disk_io`/`remote_disk_io` components of the execution-time breakdown (see time section) — Snowflake's IO timing is inherently part of the time breakdown, not a separate stat |
| Derived cache hit ratio | `bufferHits / (bufferHits + bufferReads)`, computable directly from Postgres's split fields | Approximate at best, from logical vs. physical read counts — label as approximate in the UI, don't present it with Postgres-level confidence | Use `io.percentage_scanned_from_cache` directly — it's already a per-operator percentage, not something this app needs to derive |
| Network transfer | Not a distinct per-node concept in Postgres's own `EXPLAIN` output | Not a distinct per-node concept in Showplan XML | `network.network_bytes` (Episode 33, `NetworkInfo.bytesSent`) — a top-level statistic sibling to `io`, not nested inside it |
| Result read/write | N/A | N/A | `io.bytes_written_to_result`/`io.bytes_read_from_result` (Episode 33, `IoInfo.bytesWrittenToResult`/`bytesReadFromResult`) — the result-cache transfer path, most relevant on a root `Result` operator returning a large result set |

**Handling note for Postgres specifically**: buffer/cache stats require the plan to have been captured with `BUFFERS` (and I/O timing additionally requires `track_io_timing`). A plan captured without these flags simply won't have this data — the detail panel must say "buffer stats not captured — re-run with `EXPLAIN (ANALYZE, BUFFERS)`" rather than showing zeros, which would misrepresent an absent measurement as an actual zero-I/O result.

**SQL Server read-ahead** (`io.readAheads`, from `RunTimeCountersPerThread`'s `ActualReadAheads`): a real, separate statistic from `ActualPhysicalReads` — read-ahead is SQL Server's own deliberate sequential-prefetch mechanism (pulling in pages a scan is expected to need next), not evidence of buffer-pool pressure the way an ordinary (non-prefetched) physical read is. `buffer-cache-inefficiency` (`src/rules/bufferCacheInefficiency.ts`) excludes read-ahead pages from the read count before judging SQL Server's cache-hit ratio, and discloses the exclusion in its `longText` rather than silently adjusting the number. Postgres has no equivalent concept exposed in `EXPLAIN` output; `readAheads` stays `undefined` there.

**Correction (Episode 33) to a previous claim in this catalog**: this section used to state, as a "genuine Snowflake gap, not yet closed," that the "percentage scanned from cache" statistic was ONLY available from `QUERY_HISTORY`/the Query Profile summary — a different data source than `GET_QUERY_OPERATOR_STATS()` — and therefore could never be captured from this app's single-paste input. **That claim was wrong.** Verified directly against Snowflake's own `GET_QUERY_OPERATOR_STATS` function reference (docs.snowflake.com): `percentage_scanned_from_cache` is a real field inside the `io` object of OPERATOR_STATISTICS, reported per-operator, in the exact input this parser already accepts. It's now captured as `IoInfo.percentageScannedFromCache` (`buildTree.ts`'s `deriveIo()`). `bufferCacheInefficiency.ts`'s Snowflake path still also has the `timeBreakdown` local/remote-disk-I/O share available as a second, independent I/O signal (§7) — the two aren't redundant (one is a cache-hit percentage, the other is a time-share breakdown), but neither is a "gap" any longer, and a future rule-engine story could use the now-real cache percentage more directly than the time-share proxy alone.

## 6. Disk spill

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Spill occurred | Inferable from `Sort Method` containing `"external"` (e.g. `"external merge"` vs. `"quicksort"`/`"top-N heapsort"` which stay in memory), or from Hash node's `Batches` exceeding 1 (indicates the hash table spilled to multiple batches on disk) | `<Warnings><SpillToTempDb SpillLevel="N"/></Warnings>` element — directly present when a Sort or Hash operation spills to tempdb | `local_disk_io`/`remote_disk_io` values under an operator's execution-time breakdown being non-zero indicates spill; more explicitly, `spilling.bytes_spilled_local_storage`/`spilling.bytes_spilled_remote_storage` — a TOP-LEVEL `spilling` object in OPERATOR_STATISTICS, a sibling of `io`, not nested inside it (corrected in Episode 33 — see note below) |
| Spill severity/level | Not a discrete severity field — inferable from `Sort Space Used` size relative to available memory (not directly known from the plan alone) | `SpillLevel` attribute on the `SpillToTempDb` warning element — a higher number is a reasonable "more severe" signal, but this catalog previously stated two different, unverified claims about what it precisely encodes (recursion depth vs. sort-vs-hash indicator); neither has a confirmed source, so `sqlServerSortSpill.ts` (2026-09-08) deliberately escalates severity on it without asserting a specific mechanism in user-facing text | Remote-storage spill is a stronger warning signal than local-storage spill — remote spill indicates the local disk itself was insufficient, a more severe condition than local spill alone |
| Related memory context | `Sort Space Used` / `Sort Space Type` (`"Disk"` vs `"Memory"`) directly states whether a sort stayed in memory | `MemoryGrantInfo` element (`GrantedMemory`, `MaxUsedMemory`, `RequestedMemory`) gives the memory-grant context around why a spill happened | Not exposed as an explicit memory-grant concept — Snowflake's warehouse sizing is the analogous lever, not visible from the plan itself |

**This is a first-class rule-engine signal** (per `rule-engine-authoring` skill) precisely because it's inconsistently surfaced across engines — Postgres requires inference from `Sort Method`/`Batches`, SQL Server states it explicitly via a warning element, Snowflake reports it via the time-breakdown/bytes-spilled statistics. The `spill.occurred` boolean on `PlanNode` exists specifically to give the rule engine and the panel one consistent field to check, regardless of how buried or explicit the underlying engine's signal is.

**Genuine SQL Server gap, confirmed (2026-09-08)**: Showplan XML has no separately-named tempdb write count or page count for a spill, for any operator — `RunTimeCountersPerThread` has no `ActualWrites`-shaped attribute in its schema at all, only reads (`ActualLogicalReads`/`ActualPhysicalReads`). `sqlServerSortSpill.ts` shows a spilling Sort's own read total (`io.bufferHits`/`bufferReads`) labeled as an attribution to the spill (a bare Sort reads nothing from a table itself), and states plainly in `longText` that writes/pages aren't available — never fabricated or approximated from another figure.

**Correction (Episode 33) — Snowflake spill nesting bug**: this app's Snowflake parser read `bytes_spilled_to_local_storage`/`bytes_spilled_to_remote_storage` from inside `statistics.io` from Episode 3 through Episode 32 — wrong container (the real field lives under a top-level `spilling` object, a sibling of `io`, not nested inside it) AND wrong field names (Snowflake's real fields have no `"_to_"` in them: `bytes_spilled_local_storage`/`bytes_spilled_remote_storage`). Verified against Snowflake's own `GET_QUERY_OPERATOR_STATS` function reference. Because Snowflake never actually emits the field names this parser was looking for, `spill.occurred` would have silently come back `false` for a genuinely spilling Snowflake plan — every Snowflake spill-related rule (`disk-spill`, `remote-spill`, `local-spill`, `sort-hotspot`) was affected. Fixed in `buildTree.ts`'s `deriveSpill()`; the two existing fixtures that encoded the wrong shape (`spill-to-remote-disk.json`) were corrected, and a new `official-shape-full-stats.json` fixture now exercises the full, verified statistics shape end-to-end.

**Correction (Episode 33) — Snowflake pruning nesting bug**: similarly, `derivePruning()` read `partitions_assigned` from `row.attributes` — wrong container (the real fields live under a top-level `pruning` object under `statistics`, not `attributes`) AND a field name Snowflake's real schema doesn't contain at all (the real field is `partitions_scanned`). `pruning.partitionsScanned` would have come back `undefined` for every real Snowflake TableScan, ever — `poor-partition-pruning` could never have fired against genuinely pasted Snowflake data, only against this app's own (wrongly-shaped) test fixtures. Fixed; `high-partition-count-scan.json` was corrected to the real shape. Also newly captured on the same object: `partitions_pruned_by_snowflake_optima` (`PruningInfo.partitionsPrunedByOptima`, Story 33.7).

## 7. Time (actual, and the cumulated-vs-per-execution distinction)

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Actual elapsed time (raw, as reported) | `Actual Total Time` (ms, per loop iteration as reported — see note) | Per-thread `ActualElapsedms` in `RunTimeInformation`, summed across threads for a parallel operator | `overall_percentage` of total query time, plus the `initialization`/`processing`/`synchronization`/`local_disk_io`/`remote_disk_io`/`network_communication` breakdown |
| Loop/execution count | `Actual Loops` | `ActualExecutions` (per thread) | Not an explicit loop concept in the same sense — Snowflake's operator tree doesn't re-execute a sub-operator per outer row the way a nested loop join does in Postgres/SQL Server |
| **Cumulated vs. per-execution derivation** | Postgres already reports `Actual Total Time` as **per-loop-iteration average**, multiplied by `Actual Loops` for the node's total contribution — so "cumulated" here specifically refers to **parallel-worker summation**, not loop averaging, which Postgres already handles internally. The panel's two-row display (§ Story 6.2) is therefore about worker cumulation, not loop cumulation, for Postgres specifically | SQL Server's per-thread `ActualElapsedms` values are genuinely summed across threads for a parallel operator with no automatic per-thread averaging — this is where the raw-total-vs-per-execution distinction matters most directly, since summing thread times can look far worse than the real wall-clock duration | Snowflake doesn't have a loop or per-worker concept exposed this way at the operator level — the panel's cumulated/per-execution distinction is largely a Postgres/SQL Server concern; for Snowflake, `overall_percentage` is already a wall-clock-relative figure |

**Correction to the earlier (Episode 6, Story 6.2) spec**: the two-row "cumulated vs. per-execution" display should be understood precisely, not applied uniformly — it's primarily a **parallel-worker** distinction (relevant to all three engines to varying degrees) rather than a loop distinction for Postgres, since Postgres's `Actual Total Time` is already loop-averaged by the engine itself. SQL Server's thread-summed `ActualElapsedms` is the case where this distinction is most load-bearing. Story 6.2 and the `graph-visualization` skill should be read with this clarification.

**Follow-up decision (design review, post-Episode-18)**: the correction above scoped the panel's cumulated/per-execution UI away from Postgres's loop-averaging specifically — right call for that display, but it left loop-averaging itself with no UI surface at all: a Postgres node's `Actual Rows`/`Actual Total Time` are shown as-is (per-loop averages), with `Actual Loops` shown as a separate, unconnected number — a reader has to do the `rows × loops` multiplication themselves to see the real total, and a high-loop-count node's true cost can look deceptively small. `buildStatRows.ts`'s `rowsLoopTotal` now surfaces this explicitly: an approximate "Total rows (≈, all loops)" / "Total time (≈, all loops)" row pair, shown whenever a Postgres node's `loops > 1`. Deliberately Postgres-only — SQL Server's `actualRows`/`actualTimeMs` are already real totals in this app's normalized model (thread-summed in `parseShowplanXml.ts`), and Snowflake has no loop concept at all (§7 above). "Approximate" because Postgres's own per-loop average is itself rounded per iteration — the true total can be off by up to half the loop count, same caveat Postgres's own documentation gives.

**Real bug found via manual QA (2026-09-09), confirming exactly this risk**: `highLoopCount.ts` (the one rule that reads `loops`/`actualTimeMs` generically across all three engines) was treating SQL Server's `actualTimeMs` as if it were already a per-loop average — true for Postgres, but this catalog's own line directly above already states the opposite for SQL Server ("`actualRows`/`actualTimeMs` are already real totals"). For a single-thread node with `loops > 1` (e.g. a Key Lookup on the inner side of a nested loop, executed 1,200 times, no parallelism involved at all), the rule multiplied that already-real total by `loops` AGAIN, compounding a loops² inflation (confirmed by hand: a real ~600ms total across 1,200 executions displayed as "~600ms EACH — ~720,000ms total," 1,200x too high on both figures). The existing suppression (`"Actual Time Is Cumulated Across Threads"`) only guarded the PARALLEL cross-thread cumulation case, never this single-thread loop-cumulation case. Fixed by preferring `node.actualTimePerExecutionMs` (the parser's own correctly-divided figure, identical to `actualTimeMs` for Postgres, so a strict superset fix with no Postgres behavior change) over raw `actualTimeMs` — the same discipline `keyLookupExplosion.ts` already used correctly. See `highLoopCount.ts`'s own updated header comment and `loopWork.ts`'s corrected doc comment.

## 8. Actual rows processed

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Actual rows produced | `Actual Rows` (per-loop average, same convention as time above) | `ActualRows` (per thread, in `RunTimeInformation`) | `OPERATOR_STATISTICS` per-operator row output count |
| Estimated rows | `Plan Rows` | `EstimateRows` | Row-count estimate isn't always exposed the same way for every operator type — Snowflake's optimizer is dynamic enough that a directly comparable "estimated rows" figure isn't guaranteed on every operator the way it is in Postgres/SQL Server's static cost-based plans |
| Rows read vs. rows returned (scan-level) | `Actual Rows` reflects rows *returned after* any `Filter`; `Rows Removed by Filter` gives the discarded count, letting you reconstruct rows read | `ActualRowsRead` vs `ActualRows` — SQL Server exposes both directly as separate fields on scan operators | Comparable via `TableScan`'s row output plus partition-pruning stats, though not a single unified "rows read" field |

---

## 9. Parallelism (added Episode 23, Story 23.2)

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Planned parallelism | `Workers Planned` — per-node, on any operator eligible for parallel execution | `QueryPlan`'s own `DegreeOfParallelism` attribute — **query-level**, not per-node; SQL Server decides a compiled plan's DOP once for the whole plan, not per operator, so there is no per-node "planned" figure to capture the way Postgres has one | Not exposed at any level — `GET_QUERY_OPERATOR_STATS()` has no worker/thread/parallelism concept at all, per-node or per-query |
| Observed parallelism at execution time | `Workers Launched` — per-node | Derived: the count of distinct `RunTimeCountersPerThread` entries under a node's own `RunTimeInformation` (already captured, `ParallelInfo.workersLaunched`, pre-dating this story) — genuinely per-node, unlike the planned figure above | Not exposed |
| Why a plan didn't run in parallel | Not directly stated — inferable only from the planned-vs-launched gap itself | `QueryPlan`'s own `NonParallelPlanReason` attribute, when SQL Server recorded one — free text, no verified complete enumeration of every value it can take (some describe a deliberate configuration choice, e.g. an explicit `MAXDOP` setting, not a problem; see `parallelWorkerShortfall.ts`'s own doc comment for why this app only ever uses it as enrichment, never an independent trigger) | Not exposed |

Both `compiledDegreeOfParallelism` and `nonParallelPlanReason` are captured on `ParallelInfo` (`normalize.ts`) but — unlike `workersLaunched`/`workersPlanned`, which are genuinely per-node — are only ever populated on the **root node**, mirroring how Postgres's top-level `Planning Time` attaches to the root rather than a specific operator (`parseJsonPlan.ts`). `PlanContext` surfaces `compiledDegreeOfParallelism` from `root.parallel?.compiledDegreeOfParallelism`, the same "root field → context field" pattern `totalEstimatedCost`/`totalActualTimeMs` already use.

---

## 10. Postgres advanced fields (Episode 24)

Every field below is **Postgres-only** — none of it has a SQL Server or Snowflake equivalent this app's data sources expose, so these all live on Postgres-specific sub-objects/rules rather than the shared cross-engine model. JSON key names confirmed against real `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS, WAL)` output and this repo's own fixtures; TEXT-format equivalents confirmed against Postgres's documented plain-EXPLAIN output shape and locked in with dedicated parser tests (`extendedFields.test.ts`) — three of them (Sort Method+space, Hash Buckets+Batches+Memory, `WAL:` records/fpi/bytes) pack multiple stats onto one combined line that the generic single-`Key: Value`-per-line detail mechanism (`textParser.ts`'s own `DETAIL_KV_RE`) can't parse correctly, so those three got dedicated regexes rather than falling through to the generic path.

| Field | JSON key(s) | TEXT shape | Normalized on |
|---|---|---|---|
| Heap fetches (Index Only Scan) | `Heap Fetches` | `Heap Fetches: N` (generic) | `PlanNode.heapFetches`, per-node |
| Rows removed by a join's own filter | `Rows Removed by Join Filter` | `Rows Removed by Join Filter: N` (generic) | `PlanNode.rowsRemovedByJoinFilter`, per-node |
| Sort method/space | `Sort Method`, `Sort Space Used` (KB), `Sort Space Type` (`"Disk"`\|`"Memory"`) | `Sort Method: X  Disk: NkB` / `Sort Method: X  Memory: NkB` — ONE combined line, dedicated regex | `PlanNode.sort` (`SortInfo`), per-node, Sort operators only |
| Hash batching | `Hash Buckets`, `Hash Batches`, `Original Hash Batches`, `Peak Memory Usage` (KB) | `Buckets: N (originally M)  Batches: N (originally M)  Memory Usage: NkB` — ONE combined line, dedicated regex; the buckets-side `(originally M)` isn't captured (no normalized field for it — Postgres's JSON output has no `Original Hash Buckets` key either) | `PlanNode.hash` (`HashInfo`), per-node, Hash operators only |
| Memoize cache stats | `Cache Hits`, `Cache Misses`, `Cache Evictions`, `Cache Overflows`, `Peak Memory Usage` (KB) | Not specially parsed — TEXT-format Memoize cache-stat lines are a known gap, JSON-only for now | `PlanNode.memoize` (`MemoizeInfo`), per-node, Memoize operators only. **`Peak Memory Usage` is the exact same JSON key Hash also uses** — `extendedFields.ts`'s `derivePostgresExtendedFields` takes `operatorType` specifically to route this one correctly, not guessable from the key name alone |
| Temp-file I/O | `Temp Read Blocks`, `Temp Written Blocks` | Both generic | `IoInfo.tempReadBlocks`/`tempWrittenBlocks` — a genuinely different I/O concern from `bufferHits`/`bufferReads` (shared buffer cache), which is why they're separate fields on the same `IoInfo` rather than folded together |
| WAL generation | `WAL Records`, `WAL FPI`, `WAL Bytes` | `WAL: records=N fpi=M bytes=P` — ONE combined line using `key=value` pairs (not `Key: Value`), dedicated regex | `PlanNode.wal` (`WalInfo`), per-node — whichever write operator generated it, not a whole-query fact |
| Partition-pruning subplans removed | `Subplans Removed` | Generic | `PruningInfo.subplansRemoved` — shares the `pruning` field with Snowflake's `partitionsScanned`/`partitionsTotal` (a related but structurally different "how much did pruning avoid" concept, not the same field reused across engines) |
| Planning/Execution Time as real numbers | Top-level `Planning Time`/`Execution Time` (already captured as raw strings in `attributes` pre-Episode-24) | Trailing `Planning Time: N ms`/`Execution Time: N ms` summary lines (already landed in the root's raw `attributes` via the generic mechanism pre-Episode-24, just never parsed to a number) | `PlanNode.planningTimeMs`/`executionTimeMs`, root-node-only |
| JIT compilation timing | Top-level `JIT.Timing` object (`Generation`/`Inlining`/`Optimization`/`Emission`/`Total`) | Not specially parsed — TEXT-format JIT's own multi-line nested block (`JIT:` header + indented `Functions:`/`Options:`/`Timing:` sub-lines) is a known gap, JSON-only for now; lower confidence in getting an unverified multi-line block regex exactly right than the single combined-lines above, so left honestly unsupported rather than guessed | `PlanNode.jit` (`JitInfo`), root-node-only |

**Known TEXT-format gaps, stated plainly rather than silently unsupported**: Memoize's cache-stat line and the JIT block are JSON-only for now. Every other Episode 24 field (including the three combined-line shapes) has real TEXT support, verified with dedicated parser tests — this isn't "TEXT format is second-class," it's "these two specific shapes weren't confirmed carefully enough to ship without a real Postgres instance to check against."

---

## 11. Snowflake official-shape fields (Episode 33)

Every field below is **Snowflake-only**, verified directly against Snowflake's own `GET_QUERY_OPERATOR_STATS` function reference (docs.snowflake.com) rather than assumed from memory — see `snowflake-plan-parsing` skill's own "OPERATOR_STATISTICS's real shape" section for the full nesting diagram. Two pre-existing fields (`spill`/`pruning`) had real nesting-and-naming bugs fixed as part of this same episode — see the correction notes in §5/§6 above.

| Field | Real OPERATOR_STATISTICS key | Normalized on |
|---|---|---|
| Cache-hit percentage | `io.percentage_scanned_from_cache` | `IoInfo.percentageScannedFromCache`, per-node (corrects the disproven "query-level only" claim previously in §5) |
| External-table/stage bytes scanned | `io.external_bytes_scanned` | `IoInfo.externalBytesScanned`, per-node |
| Result-transfer bytes | `io.bytes_written_to_result`, `io.bytes_read_from_result` | `IoInfo.bytesWrittenToResult`/`bytesReadFromResult`, per-node |
| Network bytes | `network.network_bytes` (a TOP-LEVEL sibling of `io`, not nested inside it) | `PlanNode.network` (`NetworkInfo.bytesSent`), per-node |
| Search Optimization Service pruning | `search_optimization.partitions_pruned_by_search_optimization`, `search_optimization.partitions_pruned_by_search_optimization_and_snowflake_optima` | `PlanNode.searchOptimization` (`SearchOptimizationInfo`), per-node. A genuinely different mechanism from Optima pruning below — this is specifically the paid, opt-in Search Optimization feature's own effectiveness |
| Snowflake Optima pruning | `pruning.partitions_pruned_by_snowflake_optima` | `PruningInfo.partitionsPrunedByOptima`, per-node. Optima is automatic/non-opt-in — kept on the base `PruningInfo` object rather than `SearchOptimizationInfo` since it's the base pruning mechanism working harder, not a separate paid feature |
| DML row counts | `dml.number_of_rows_inserted`, `number_of_rows_updated`, `number_of_rows_deleted`, `number_of_rows_unloaded` | `PlanNode.dml` (`DmlInfo`), present only on DML operator nodes (`Insert`/`Update`/`Delete`/`Merge`/`Unload` — newly mapped in `operatorMap.ts`, with real glossary entries, not just the raw fallback) |
| Step grouping | `STEP_ID` column (not part of OPERATOR_STATISTICS itself — a sibling column on the same result row) | `PlanNode.stepId`, per-node. Snowflake's Query Profile UI groups operators into numbered execution steps this way; previously discarded entirely during row parsing |

**`input_rows` — now captured (addendum after Episode 34)**: originally left uncaptured by Episode 33 itself (see the historical note this replaces, below) to avoid an unrequested behavior change to every rule already built on the derived figure. Explicitly revisited afterward: `PlanNode.inputRows` now captures the real top-level `input_rows` statistic directly, and every rule that previously derived "input rows" by summing/maxing children's own `actualRows` (`explodingJoin.ts` and the Episode 32/34 rules built on its technique) now goes through `inputRowsDetail.ts`'s shared `resolveInputRows()`, which prefers the real field and falls back to that same derivation only when it's absent. `filterRowsDiscarded.ts`'s own Snowflake-derived case similarly prefers the real field over its single-child fallback, and drops its "this is computed" disclosure sentence when the real field is what's actually used. `io.scan_progress` and `io.bytes_written` (a general write-bytes figure, distinct from the result-transfer bytes above) remain uncaptured — real fields, just not part of this addendum or any of Episode 33's ten stories.

*Historical note (Episode 33's own original text, kept for the record): "this app currently derives 'input rows' for a node by summing its children's own `actualRows` instead ... a decision for a future episode to make explicitly, not a small addition to slip in here." That decision was made explicitly, per the addendum above.*

---

## Summary of genuine cross-engine gaps (state these honestly in the UI, never paper over them)

- **Index type** (btree/gin/gist/hash) — not reliably available from Postgres's plan alone; not applicable to Snowflake at all; directly available on SQL Server via `IndexKind`.
- **Abstract cost units** — meaningful for Postgres and SQL Server, not a concept Snowflake's optimizer exposes; Snowflake nodes should show time/bytes/pruning-based equivalents instead of a blank or fabricated cost field.
- **Cache hit ratio precision** — cleanly computable for Postgres (with `BUFFERS` enabled), approximate for SQL Server, and only query-level (not per-node) for Snowflake.
- **Loop-based cumulation** — a real concern for Postgres specifically (its `Actual Rows`/`Actual Total Time` are per-loop averages needing an explicit `× Actual Loops` to see the true total — now surfaced directly, see the follow-up decision above); SQL Server's equivalent fields are already real totals in this app's model, and Snowflake has no loop concept in the same form at all.
- **Partition pruning** — a Snowflake-specific concept (`partitionsScanned`/`partitionsTotal`) with no Postgres/SQL Server equivalent (those engines don't organize storage into pruning-relevant micro-partitions the same way).
- **Parallelism** (§9 above) — Postgres has both a planned and an observed per-node figure; SQL Server has a query-level planned figure (`DegreeOfParallelism`) but only a per-node observed one, and no per-node "planned" concept at all; Snowflake exposes nothing here whatsoever — a permanent, checked ceiling (Episode 23's own dimension table), not a gap expected to close later.
- **Every §10 field (Episode 24)** — heap fetches, join-filter row discards, Sort/Hash internals, temp I/O, WAL generation, partition-pruning subplan counts, Planning/JIT timing — all Postgres-only, permanently, not a gap to close: none of these concepts exist in SQL Server's Showplan XML or Snowflake's `GET_QUERY_OPERATOR_STATS()` output at all, checked directly rather than assumed.

This table of gaps should be treated as a living checklist for the `operator-glossary-content` and `graph-visualization` skills: any time the detail panel would otherwise show an empty or zero-looking field for one of these, it should instead show a short, honest "not applicable for this engine" or "not captured in this plan" note.
