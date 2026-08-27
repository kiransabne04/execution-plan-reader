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
    bytesScanned?: number       // Snowflake-specific, no direct Postgres/SQL Server equivalent
  }

  spill?: {
    occurred: boolean
    bytesLocal?: number
    bytesRemote?: number        // Snowflake-specific distinction; Postgres/SQL Server don't separate local/remote
    detail?: string             // engine-specific free text (e.g. SQL Server's SpillLevel, sort vs. hash spill)
  }

  pruning?: {                   // Snowflake-specific — no Postgres/SQL Server equivalent
    partitionsScanned?: number
    partitionsTotal?: number
  }

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
| Cache/buffer hits | `Shared Hit Blocks` (+ `Local Hit Blocks` for temp objects) — requires `BUFFERS` in the `EXPLAIN` call | `RunTimeInformation`'s per-thread `ActualLogicalReads` roughly corresponds (logical reads include buffer-cache hits); SQL Server doesn't cleanly separate "from cache" vs "from disk" the way Postgres's Shared Hit/Read split does | Reported at the query level as a "percentage scanned from cache" style statistic rather than a per-operator field — coarser granularity than Postgres/SQL Server |
| Disk reads | `Shared Read Blocks` (+ `Local Read Blocks`) | `ActualPhysicalReads` (per-thread, in `RunTimeInformation`) | `bytesScanned` on `TableScan` operators is the closest available signal — not a hit/read split, a total-bytes-read figure |
| I/O timing | `I/O Read Time` / `I/O Write Time` — requires `BUFFERS` **and** `track_io_timing = on` at the server level; absent otherwise, and the panel must not imply zero I/O time when the setting simply wasn't enabled | Not typically broken out as a separate timing field distinct from the operator's overall elapsed time | Folded into the operator's `local_disk_io`/`remote_disk_io` components of the execution-time breakdown (see time section) — Snowflake's IO timing is inherently part of the time breakdown, not a separate stat |
| Derived cache hit ratio | `bufferHits / (bufferHits + bufferReads)`, computable directly from Postgres's split fields | Approximate at best, from logical vs. physical read counts — label as approximate in the UI, don't present it with Postgres-level confidence | Use the query-level cache percentage directly where available; note it's query-level, not per-node, if displayed on an individual node |

**Handling note for Postgres specifically**: buffer/cache stats require the plan to have been captured with `BUFFERS` (and I/O timing additionally requires `track_io_timing`). A plan captured without these flags simply won't have this data — the detail panel must say "buffer stats not captured — re-run with `EXPLAIN (ANALYZE, BUFFERS)`" rather than showing zeros, which would misrepresent an absent measurement as an actual zero-I/O result.

## 6. Disk spill

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Spill occurred | Inferable from `Sort Method` containing `"external"` (e.g. `"external merge"` vs. `"quicksort"`/`"top-N heapsort"` which stay in memory), or from Hash node's `Batches` exceeding 1 (indicates the hash table spilled to multiple batches on disk) | `<Warnings><SpillToTempDb SpillLevel="N"/></Warnings>` element — directly present when a Sort or Hash operation spills to tempdb; SQL Server 2016+ additionally provides `SortSpillDetails`/`HashSpillDetails` with page counts | `local_disk_io`/`remote_disk_io` values under an operator's execution-time breakdown being non-zero indicates spill; more explicitly, bytes-spilled-to-local-storage and bytes-spilled-to-remote-storage figures are available in Snowflake's query statistics |
| Spill severity/level | Not a discrete severity field — inferable from `Sort Space Used` size relative to available memory (not directly known from the plan alone) | `SpillLevel` attribute on the `SpillToTempDb` warning element (level 1 vs. level 2 indicates sort vs. hash spill severity conventions) | Remote-storage spill is a stronger warning signal than local-storage spill — remote spill indicates the local disk itself was insufficient, a more severe condition than local spill alone |
| Related memory context | `Sort Space Used` / `Sort Space Type` (`"Disk"` vs `"Memory"`) directly states whether a sort stayed in memory | `MemoryGrantInfo` element (`GrantedMemory`, `MaxUsedMemory`, `RequestedMemory`) gives the memory-grant context around why a spill happened | Not exposed as an explicit memory-grant concept — Snowflake's warehouse sizing is the analogous lever, not visible from the plan itself |

**This is a first-class rule-engine signal** (per `rule-engine-authoring` skill) precisely because it's inconsistently surfaced across engines — Postgres requires inference from `Sort Method`/`Batches`, SQL Server states it explicitly via a warning element, Snowflake reports it via the time-breakdown/bytes-spilled statistics. The `spill.occurred` boolean on `PlanNode` exists specifically to give the rule engine and the panel one consistent field to check, regardless of how buried or explicit the underlying engine's signal is.

## 7. Time (actual, and the cumulated-vs-per-execution distinction)

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Actual elapsed time (raw, as reported) | `Actual Total Time` (ms, per loop iteration as reported — see note) | Per-thread `ActualElapsedms` in `RunTimeInformation`, summed across threads for a parallel operator | `overall_percentage` of total query time, plus the `initialization`/`processing`/`synchronization`/`local_disk_io`/`remote_disk_io`/`network_communication` breakdown |
| Loop/execution count | `Actual Loops` | `ActualExecutions` (per thread) | Not an explicit loop concept in the same sense — Snowflake's operator tree doesn't re-execute a sub-operator per outer row the way a nested loop join does in Postgres/SQL Server |
| **Cumulated vs. per-execution derivation** | Postgres already reports `Actual Total Time` as **per-loop-iteration average**, multiplied by `Actual Loops` for the node's total contribution — so "cumulated" here specifically refers to **parallel-worker summation**, not loop averaging, which Postgres already handles internally. The panel's two-row display (§ Story 6.2) is therefore about worker cumulation, not loop cumulation, for Postgres specifically | SQL Server's per-thread `ActualElapsedms` values are genuinely summed across threads for a parallel operator with no automatic per-thread averaging — this is where the raw-total-vs-per-execution distinction matters most directly, since summing thread times can look far worse than the real wall-clock duration | Snowflake doesn't have a loop or per-worker concept exposed this way at the operator level — the panel's cumulated/per-execution distinction is largely a Postgres/SQL Server concern; for Snowflake, `overall_percentage` is already a wall-clock-relative figure |

**Correction to the earlier (Episode 6, Story 6.2) spec**: the two-row "cumulated vs. per-execution" display should be understood precisely, not applied uniformly — it's primarily a **parallel-worker** distinction (relevant to all three engines to varying degrees) rather than a loop distinction for Postgres, since Postgres's `Actual Total Time` is already loop-averaged by the engine itself. SQL Server's thread-summed `ActualElapsedms` is the case where this distinction is most load-bearing. Story 6.2 and the `graph-visualization` skill should be read with this clarification.

## 8. Actual rows processed

| Concept | Postgres source | SQL Server source | Snowflake source |
|---|---|---|---|
| Actual rows produced | `Actual Rows` (per-loop average, same convention as time above) | `ActualRows` (per thread, in `RunTimeInformation`) | `OPERATOR_STATISTICS` per-operator row output count |
| Estimated rows | `Plan Rows` | `EstimateRows` | Row-count estimate isn't always exposed the same way for every operator type — Snowflake's optimizer is dynamic enough that a directly comparable "estimated rows" figure isn't guaranteed on every operator the way it is in Postgres/SQL Server's static cost-based plans |
| Rows read vs. rows returned (scan-level) | `Actual Rows` reflects rows *returned after* any `Filter`; `Rows Removed by Filter` gives the discarded count, letting you reconstruct rows read | `ActualRowsRead` vs `ActualRows` — SQL Server exposes both directly as separate fields on scan operators | Comparable via `TableScan`'s row output plus partition-pruning stats, though not a single unified "rows read" field |

---

## Summary of genuine cross-engine gaps (state these honestly in the UI, never paper over them)

- **Index type** (btree/gin/gist/hash) — not reliably available from Postgres's plan alone; not applicable to Snowflake at all; directly available on SQL Server via `IndexKind`.
- **Abstract cost units** — meaningful for Postgres and SQL Server, not a concept Snowflake's optimizer exposes; Snowflake nodes should show time/bytes/pruning-based equivalents instead of a blank or fabricated cost field.
- **Cache hit ratio precision** — cleanly computable for Postgres (with `BUFFERS` enabled), approximate for SQL Server, and only query-level (not per-node) for Snowflake.
- **Loop-based cumulation** — a real concern for Postgres/SQL Server nested-loop-style re-execution; not a Snowflake concept in the same form.
- **Partition pruning** — a Snowflake-specific concept (`partitionsScanned`/`partitionsTotal`) with no Postgres/SQL Server equivalent (those engines don't organize storage into pruning-relevant micro-partitions the same way).

This table of gaps should be treated as a living checklist for the `operator-glossary-content` and `graph-visualization` skills: any time the detail panel would otherwise show an empty or zero-looking field for one of these, it should instead show a short, honest "not applicable for this engine" or "not captured in this plan" note.
