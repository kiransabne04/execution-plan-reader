// Episode 4 — shared PlanNode model that every engine parser compiles down to.
// See .claude/skills/plan-normalization/SKILL.md before editing this file.

export type Engine = "postgres" | "sqlserver" | "snowflake"

/**
 * Where a node sits relative to the main top-to-bottom execution flow.
 * InitPlan/SubPlan nodes (Postgres) and similar constructs in other engines
 * are not part of the primary path and must be tagged so the graph layer
 * can render them distinctly (e.g. a side branch) rather than inline.
 */
export type PlanNodeRole = "main" | "init" | "sub"

/** Design review (downloaded "expert overlay details" PNG), spec §1f:
 * "Rule provenance is the Expert-only part of the finding: rule id, the
 * threshold it tested, the computed value that tripped it, and any
 * additional conditions. Experts distrust findings they cannot audit."
 * Populated at authoring time from each rule's own real constants — same
 * "no live generation" discipline `shortText`/`longText` already follow
 * (rule-engine-authoring skill) — never computed generically after the
 * fact from `threshold`/`computed` alone, since a rule's real trigger
 * logic (a compound AND/OR, a ratio vs. an absolute floor together) often
 * isn't just "value > threshold". Optional: a rule with no single crisp
 * numeric threshold (the parameter-sensitivity/estimate-only honesty
 * notes, which aren't defect diagnoses at all) omits it rather than
 * fabricating one. */
export interface WarningProvenance {
  /** The condition tested, in the rule's own terms — e.g.
   * `"discard_ratio > 0.90"`. A real constant/expression from the rule's
   * own source, not a generic restatement of the prose. */
  threshold: string
  /** The actual computed value that tripped (or, for a rule with no
   * single scalar trigger, the closest real computed figure) — e.g.
   * `"0.996"`. */
  computed: string
  /** Any additional conditions the rule also required to fire (a
   * materiality floor, a row-count minimum) — omitted when the rule has
   * exactly one condition. */
  additionalConditions?: string[]
}

export interface Warning {
  ruleId: string
  severity: "info" | "warning" | "critical"
  shortText: string // beginner-depth default
  longText: string // expert-depth / detail panel
  learnMoreUrl?: string // link into existing @scalingbackend content, when available
  provenance?: WarningProvenance
}

/**
 * Logical join semantics (inner/outer/semi/anti/cross) — a separate axis
 * from the join *algorithm* (hash/nested-loop/merge), which is already
 * captured by `operatorType`. See docs/10-node-stats-field-catalog.md §3.
 */
export type JoinLogicalType = "inner" | "left_outer" | "right_outer" | "full_outer" | "semi" | "anti" | "cross"

export interface PredicateInfo {
  /** A WHERE-style residual condition applied after reading a row. */
  filter?: string
  /** A condition satisfied by an index seek/range itself, not a post-filter. */
  indexCondition?: string
  /** The ON/USING condition for a join operator. */
  joinCondition?: string
}

export interface IndexInfo {
  name?: string
  /** Normalized where determinable; "not available from the plan alone" is
   * a real, honest state for some engines (see field catalog §2), not a bug. */
  type?: "btree" | "hash" | "gin" | "gist" | "clustered" | "nonclustered" | "columnstore" | "heap" | "bitmap" | "unknown"
  scanDirection?: string
}

export interface JoinInfo {
  logicalType?: JoinLogicalType
}

export interface IoInfo {
  /** Pages/blocks served from cache. */
  bufferHits?: number
  /** Pages/blocks read from disk. */
  bufferReads?: number
  /** Derived: bufferHits / (bufferHits + bufferReads), where computable. */
  cacheHitRatio?: number
  ioReadTimeMs?: number
  ioWriteTimeMs?: number
  /** Snowflake-specific — no direct Postgres/SQL Server equivalent. */
  bytesScanned?: number
  /** SQL Server-specific (`RunTimeCountersPerThread`'s `ActualReadAheads`)
   * — no Postgres/Snowflake equivalent. Read-ahead is SQL Server's
   * deliberate sequential-prefetch mechanism: pages it pulls in expecting a
   * scan to need them next, not evidence of buffer-pool pressure the way
   * an ordinary (non-prefetched) physical read is. A scan whose physical
   * reads are mostly explained by read-ahead is behaving efficiently, not
   * poorly — see `bufferCacheInefficiency.ts`, which excludes read-ahead
   * pages from `bufferReads` before judging the cache-hit ratio. */
  readAheads?: number
  /** Episode 24, Story 24.6 — Postgres-specific (`Temp Read/Written
   * Blocks`, `BUFFERS` option), blocks read from/written to TEMP FILES
   * (a sort/hash operator that spilled), not the shared buffer cache —
   * a genuinely different I/O concern from `bufferHits`/`bufferReads`
   * above, which is why it's a separate pair of fields, not folded into
   * those. See `temporaryIo.ts`'s own doc comment for why this is related
   * to, but deliberately not merged into, the `disk-spill`/hash-batching
   * findings. */
  tempReadBlocks?: number
  tempWrittenBlocks?: number
  /** Episode 25 — Postgres's `Shared/Local Dirtied Blocks` (a page this
   * node modified in the buffer cache, not yet flushed) and `Shared/Local
   * Written Blocks` (a page this node itself flushed to make room for
   * another). Postgres-only — SQL Server/Snowflake expose no equivalent
   * distinct from the read/write figures already above. */
  bufferDirtied?: number
  bufferWritten?: number
  /** Episode 33, Story 33.3 — Snowflake-specific, `io.percentage_scanned_from_cache`
   * in `GET_QUERY_OPERATOR_STATS()`'s own OPERATOR_STATISTICS object.
   * Correction to a prior (Episode 4-era) claim in this file's own field
   * catalog (docs/10-node-stats-field-catalog.md §5) that this statistic
   * was ONLY available from `QUERY_HISTORY`/the Query Profile summary, not
   * from `GET_QUERY_OPERATOR_STATS()` — verified against Snowflake's own
   * function reference (docs.snowflake.com) that it IS present per-operator
   * in this exact input this parser already accepts; that claim was wrong
   * and has been corrected in the field catalog. A genuinely different
   * concept from the generic `cacheHitRatio` above (which is DERIVED from
   * Postgres's own hit/read block split) — this is Snowflake's own directly
   * reported percentage, kept as its own field rather than conflated with
   * a derived ratio from a different engine's different accounting. */
  percentageScannedFromCache?: number
  /** Episode 33, Story 33.5 — Snowflake-specific, `io.external_bytes_scanned`.
   * Bytes read from an external table/stage (e.g. Parquet/CSV files in
   * cloud storage), a genuinely different I/O path from `bytesScanned`
   * (Snowflake's own native micro-partition storage). */
  externalBytesScanned?: number
  /** Episode 33, Story 33.6 — Snowflake-specific, `io.bytes_written_to_result`/
   * `io.bytes_read_from_result`. The result-transfer path (writing a
   * query's own output to Snowflake's result cache/service, and reading it
   * back for a client) — a distinct I/O concern from scanning source
   * tables, most relevant on a root `Result` operator returning a large
   * result set. */
  bytesWrittenToResult?: number
  bytesReadFromResult?: number
}

/** Episode 33, Story 33.4 — Snowflake-specific, `network.network_bytes` in
 * `GET_QUERY_OPERATOR_STATS()`'s OPERATOR_STATISTICS — a top-level sibling
 * of `io`/`pruning`/`spilling`, not nested inside any of those, mirrored
 * here as its own field for the same reason `pruning`/`spill` are their
 * own `PlanNode` fields rather than folded into `io`. Named `bytesSent`
 * (documented as reachable via `networkTimeDominant.ts`'s existing
 * `timeBreakdown.networkCommunicationPercentage` for the TIME side of
 * network cost) — the official field is just `network_bytes` with no
 * documented send/receive distinction; this is the total byte volume
 * Snowflake attributes to network communication for this operator, not
 * assumed to be exclusively outbound. */
export interface NetworkInfo {
  bytesSent?: number
}

/** Episode 33, Story 33.7 — Snowflake-specific, the `search_optimization`
 * object in `GET_QUERY_OPERATOR_STATS()`'s OPERATOR_STATISTICS. A genuinely
 * different pruning mechanism from the base micro-partition pruning already
 * captured on `PruningInfo` (`partitionsScanned`/`partitionsTotal`) — this
 * is specifically how many additional partitions the Search Optimization
 * Service (a paid, opt-in feature) was able to prune, alone or in
 * combination with Snowflake Optima (the automatic, non-opt-in pruning
 * enhancement also captured separately on `PruningInfo.partitionsPrunedByOptima`).
 * Kept as its own object (not folded into `PruningInfo`) since it answers a
 * different question — "how effective was this specific paid feature" —
 * not "how much pruning happened overall". */
export interface SearchOptimizationInfo {
  partitionsPrunedBySearchOptimization?: number
  partitionsPrunedBySearchOptimizationAndOptima?: number
}

/** Episode 33, Story 33.9 — Snowflake-specific, the `dml` object in
 * `GET_QUERY_OPERATOR_STATS()`'s OPERATOR_STATISTICS, present on DML
 * operator nodes (Insert/Update/Delete/Merge/Unload — see `operatorMap.ts`).
 * No Postgres/SQL Server equivalent in this app's current parsers (both
 * only ever parse read-only `EXPLAIN` output, never DML plans). */
export interface DmlInfo {
  rowsInserted?: number
  rowsUpdated?: number
  rowsDeleted?: number
  rowsUnloaded?: number
}

/** Episode 24, Story 24.5 — Postgres-specific, Sort nodes only. `method` is
 * Postgres's own free-text wording ("quicksort", "external merge", "top-N
 * heapsort", "external sort", etc. — not a closed enum this app defines,
 * since Postgres itself doesn't guarantee one; see `sortDiskSpill.ts`'s own
 * doc comment for the full list this app currently recognizes as
 * disk-based). `spaceUsedKb`/`spaceType` are populated together — a plan
 * without `EXPLAIN (ANALYZE)` never reports either. */
export interface SortInfo {
  method?: string
  spaceUsedKb?: number
  spaceType?: "memory" | "disk"
}

/** Episode 24, Story 24.4 — Postgres-specific, Hash nodes only. `batches`/
 * `originalBatches` differing is the real "the hash table didn't fit in
 * memory and had to be reprocessed in multiple batches" signal — related
 * to, but a distinct concern from, the generic `spill` field above (see
 * `hashBatching.ts`'s own doc comment for why this stays a separate
 * finding rather than folding into `disk-spill`). */
export interface HashInfo {
  buckets?: number
  batches?: number
  originalBatches?: number
  peakMemoryKb?: number
}

/** Episode 24, Story 24.10 — Postgres-specific, Memoize nodes only. */
export interface MemoizeInfo {
  cacheHits?: number
  cacheMisses?: number
  cacheEvictions?: number
  cacheOverflows?: number
  peakMemoryKb?: number
}

/** Episode 24, Story 24.12 — Postgres-specific (`EXPLAIN (ANALYZE, WAL)`),
 * per-node — WAL is generated by the specific write operator that produced
 * it, not a whole-query fact the way Planning/Execution Time are. */
export interface WalInfo {
  records?: number
  fpi?: number
  bytes?: number
}

/** Episode 24, Story 24.8 — Postgres-specific, root-node-only: JIT
 * compilation is a whole-query fact (`EXPLAIN (ANALYZE)`'s own top-level
 * `JIT` block), not something any one operator does — mirrors how SQL
 * Server's `compiledDegreeOfParallelism`/`nonParallelPlanReason`
 * (`ParallelInfo`) are root-node-only for the same reason. */
export interface JitInfo {
  generationMs?: number
  inliningMs?: number
  optimizationMs?: number
  emissionMs?: number
  totalMs?: number
}

/** SQL Server-specific, whole-query fact (root-node-only, same "read off
 * QueryPlan once" pattern `parallel.compiledDegreeOfParallelism` already
 * uses) — one memory grant covers a query's memory-consuming operators
 * (Sort/Hash) collectively; it's not a per-operator concept the way
 * Postgres's `Sort Space Used` is. All KB, matching Showplan XML's own
 * unit convention for these attributes. `feedbackAdjusted` (SQL Server
 * 2017+ Memory Grant Feedback) is only ever set when the underlying
 * attribute is actually present in the XML — never inferred when absent. */
export interface MemoryGrantInfo {
  requestedKb?: number
  grantedKb?: number
  desiredKb?: number
  requiredKb?: number
  maxUsedKb?: number
  feedbackAdjusted?: string
}

export interface SpillInfo {
  occurred: boolean
  /** Episode 33, Story 33.1 — Snowflake's own `spilling.bytes_spilled_local_storage`
   * (a TOP-LEVEL sibling of `io`/`pruning` in OPERATOR_STATISTICS, not
   * nested inside `io` — a nesting bug this app's parser had until this
   * story; see `buildTree.ts`'s `deriveSpill()`). */
  bytesLocal?: number
  /** Snowflake-specific distinction; Postgres/SQL Server don't separate
   * local/remote. Snowflake's own field is `spilling.bytes_spilled_remote_storage`. */
  bytesRemote?: number
  /** Engine-specific free text (e.g. SQL Server's spill level, sort vs. hash spill). */
  detail?: string
}

/** `partitionsScanned`/`partitionsTotal` are Snowflake-specific — no
 * Postgres/SQL Server equivalent (those engines don't organize storage
 * into pruning-relevant micro-partitions). Snowflake's own field names are
 * `pruning.partitions_scanned`/`pruning.partitions_total` — a TOP-LEVEL
 * `pruning` object in OPERATOR_STATISTICS, not a field under `attributes`
 * (a nesting AND naming bug this app's parser had until Episode 33, Story
 * 33.2 — see `buildTree.ts`'s `derivePruning()`). `subplansRemoved`
 * (Episode 24, Story 24.11) is Postgres-specific instead — runtime
 * partition pruning on an `Append`/`MergeAppend` over a partitioned table,
 * a structurally different concept (whole child subplans skipped, not a
 * micro-partition count) that shares this same "how much work did pruning
 * avoid" theme, which is why it lives on the same `pruning` field rather
 * than a new one. */
export interface PruningInfo {
  partitionsScanned?: number
  partitionsTotal?: number
  subplansRemoved?: number
  /** Episode 33, Story 33.7 — Snowflake-specific, `pruning.partitions_pruned_by_snowflake_optima`.
   * Snowflake Optima is an automatic (non-opt-in) pruning enhancement —
   * distinct from the opt-in Search Optimization Service, whose own
   * pruning counts live on `SearchOptimizationInfo` instead. Kept on THIS
   * object (rather than `SearchOptimizationInfo`) because it's Snowflake's
   * own base pruning mechanism working harder, not a separate paid
   * feature's own effectiveness metric. */
  partitionsPrunedByOptima?: number
}

export interface ParallelInfo {
  workersLaunched?: number
  workersPlanned?: number
  /** Episode 23, Story 23.2 — SQL Server-specific, root-node-only: the
   * COMPILED plan's degree of parallelism (`QueryPlan`'s own
   * `DegreeOfParallelism` XML attribute), a query-level fact genuinely
   * different from `workersLaunched` above (a per-node OBSERVED thread
   * count). SQL Server has no per-node "planned" concept the way
   * Postgres's `workersPlanned` is — DOP is decided once, for the whole
   * compiled plan, not per operator. */
  compiledDegreeOfParallelism?: number
  /** SQL Server-specific, root-node-only: `QueryPlan`'s own
   * `NonParallelPlanReason` attribute, when SQL Server recorded why a plan
   * didn't run in parallel. Enrichment only (see `parallelWorkerShortfall.ts`'s
   * own doc comment for why this never independently triggers a finding) —
   * this app doesn't have a verified, complete enumeration of every reason
   * string SQL Server can emit, and some describe a deliberate
   * configuration choice, not a problem. */
  nonParallelPlanReason?: string
  /** Episode 25 — Design review (downloaded "expert overlay details" PNG),
   * spec §1f: "parallelism with workers planned vs launched AND per-worker
   * rows and time." Real, per-worker/per-thread data only — Postgres's own
   * `Workers` array (`Actual Rows`/`Actual Total Time` per worker) or SQL
   * Server's own per-`RunTimeCountersPerThread` figures, never a synthetic
   * average-per-worker split of the aggregate. `label` is engine-native
   * wording ("Worker 0" for Postgres, "Thread 1" for SQL Server — these are
   * genuinely different concepts, not two names for the same thing; see
   * this file's own field-catalog cross-references). Snowflake has no
   * worker/thread concept at any level (field catalog §7) — always empty
   * there, never fabricated. */
  perWorker?: { label: string; rows?: number; timeMs?: number }[]
}

/** Snowflake-specific — no Postgres/SQL Server equivalent. Snowflake doesn't
 * report a per-node elapsed-ms figure (see field catalog §7); instead each
 * component is a percentage of the *query's* total elapsed time. `actualTimeMs`
 * intentionally stays undefined for Snowflake nodes rather than misrepresent
 * a percentage as milliseconds — this is the honest, comparable-across-nodes
 * figure Snowflake actually gives you. */
export interface TimeBreakdownInfo {
  /** This node's share of the whole query's elapsed time, 0-100. */
  overallPercentage?: number
  initializationPercentage?: number
  processingPercentage?: number
  synchronizationPercentage?: number
  localDiskIoPercentage?: number
  remoteDiskIoPercentage?: number
  networkCommunicationPercentage?: number
}

export interface PlanNode {
  id: string
  engine: Engine
  operatorType: string // normalized (e.g. "seq_scan", "index_scan", "hash_join")
  rawOperatorLabel: string // original engine-specific label, always preserved
  /** Episode 33, Story 33.8 — Snowflake-specific, `GET_QUERY_OPERATOR_STATS()`'s
   * own `STEP_ID` column. Snowflake groups operators into numbered
   * execution "steps" (visible as separate step tabs in the Query Profile
   * UI) — a real grouping concept this app's parser previously discarded
   * entirely. No Postgres/SQL Server equivalent (neither engine's `EXPLAIN`
   * output groups operators into steps this way). */
  stepId?: number
  estimatedRows?: number
  actualRows?: number
  /** Rows read but discarded by a post-scan filter, where derivable. */
  rowsRemovedByFilter?: number
  /** Episode 24, Story 24.3 — Postgres-specific: rows discarded by a JOIN's
   * own residual condition (as distinct from a scan's post-read filter
   * above) — a real signal of excessive intermediate join work. */
  rowsRemovedByJoinFilter?: number
  /** Episode 24, Story 24.1 — Postgres-specific, Index Only Scan only: how
   * many of this scan's rows needed a heap visit anyway (a page not yet
   * marked all-visible in the visibility map), rather than being served
   * from the index alone. See `indexOnlyHeapFetches.ts`'s own doc comment
   * for why a high fetch ratio is NOT automatically "run VACUUM." */
  heapFetches?: number
  estimatedCost?: number
  /** Episode 25 — Design review (downloaded "expert overlay details" PNG),
   * spec §1f's "Startup / total cost" combined row. Postgres/SQL Server
   * only — both report a startup-cost figure alongside the total; Snowflake
   * has no abstract cost-unit concept at all (see `rowsCost` in
   * `buildStatRows.ts`), so this stays undefined there rather than a
   * fabricated 0. */
  startupCost?: number
  /** Episode 25 — Postgres/SQL Server's own estimated average row width in
   * bytes for this node's output (Postgres's `Plan Width`, SQL Server's
   * `AvgRowSize`). An estimate, like `estimatedRows` — never conflated with
   * a measured figure. */
  planWidth?: number
  /** Episode 25 — Postgres's `Output` list (the exact expressions this node
   * projects) — real column/expression text as the engine wrote it, never
   * inferred from the query text. SQL Server/Snowflake don't expose an
   * equivalent per-operator projection list in this app's current parsers. */
  outputColumns?: string[]
  /** As reported by the engine — see docs/10-node-stats-field-catalog.md §7
   * for exactly what "as reported" means per engine (Postgres: already
   * loop-averaged; SQL Server: summed across threads for a parallel
   * operator; Snowflake: not a comparable figure at all). */
  actualTimeMs?: number
  /** Derived per-execution approximation, explicitly separate from the raw
   * cumulated figure above so the two are never presented as the same
   * number — see the field catalog's correction: this is primarily a
   * parallel-worker/thread concern, not a Postgres loop-averaging one
   * (Postgres's actualTimeMs is already loop-averaged by the engine itself). */
  actualTimePerExecutionMs?: number
  /** Episode 25 — Postgres's own `Actual Startup Time` (the per-loop-average
   * time until this node produced its FIRST row, distinct from the total
   * time above) — real, engine-reported, not derived. Postgres-only: SQL
   * Server's `RunTimeCountersPerThread`/Snowflake's operator stats expose
   * no equivalent "time to first row" figure in this app's current parsers. */
  actualStartupTimeMs?: number
  loops?: number
  /** SQL Server-specific (`ActualRebinds`/`ActualRewinds` on
   * `RunTimeCountersPerThread`) — meaningful mainly for a Spool or the
   * inner side of a correlated nested loop. A rebind means the cached
   * inner result had to be fully rebuilt because a correlated parameter
   * changed; a rewind means it could be reused as-is. No Postgres/
   * Snowflake equivalent is exposed in this app's current parsers. */
  rebinds?: number
  rewinds?: number
  role: PlanNodeRole

  // Promoted, normalized sub-fields covering exactly the categories the
  // node detail panel needs (Episode 6 Story 6.2) — every field here is
  // optional, and absence is meaningful ("this engine/operator doesn't
  // expose this"), never papered over with a fabricated value. See
  // docs/10-node-stats-field-catalog.md, the authoritative source for this
  // part of the model.
  predicate?: PredicateInfo
  index?: IndexInfo
  join?: JoinInfo
  io?: IoInfo
  spill?: SpillInfo
  pruning?: PruningInfo
  /** Episode 33, Story 33.4 — Snowflake-specific. */
  network?: NetworkInfo
  /** Episode 33, Story 33.7 — Snowflake-specific. */
  searchOptimization?: SearchOptimizationInfo
  /** Episode 33, Story 33.9 — Snowflake-specific, present on DML operator
   * nodes (Insert/Update/Delete/Merge/Unload) only. */
  dml?: DmlInfo
  parallel?: ParallelInfo
  timeBreakdown?: TimeBreakdownInfo
  /** Episode 24, Story 24.5 — Postgres-specific, Sort nodes only. */
  sort?: SortInfo
  /** Episode 24, Story 24.4 — Postgres-specific, Hash nodes only. */
  hash?: HashInfo
  /** Episode 24, Story 24.10 — Postgres-specific, Memoize nodes only. */
  memoize?: MemoizeInfo
  /** Episode 24, Story 24.12 — Postgres-specific, per-node (whichever
   * write operator generated the WAL). */
  wal?: WalInfo
  /** Episode 24, Story 24.8 — Postgres-specific, root-node-only (see
   * `JitInfo`'s own doc comment for why). */
  jit?: JitInfo
  /** Episode 24, Story 24.7 — Postgres-specific, root-node-only: the
   * query's own top-level `Planning Time`/`Execution Time` figures,
   * promoted to real typed fields rather than left as raw strings in
   * `attributes` (which they also still carry, for backward-compatible
   * display — see `parseJsonPlan.ts`'s own comment). `executionTimeMs` is
   * deliberately a SEPARATE figure from the root node's own `actualTimeMs`
   * above — the two are usually close but not guaranteed identical
   * (`Execution Time` is the whole statement's wall time, including
   * top-level overhead `actualTimeMs` alone doesn't capture). */
  planningTimeMs?: number
  executionTimeMs?: number
  /** SQL Server-specific, root-node-only (see `MemoryGrantInfo`'s own doc
   * comment for why). */
  memoryGrant?: MemoryGrantInfo

  children: PlanNode[]
  // Engine-specific extras, untouched. Non-primitive raw values (arrays/objects,
  // e.g. Postgres's per-worker `Workers` data) are preserved as JSON strings so
  // this stays a flat Record without silently dropping structure.
  attributes: Record<string, string | number>
  warnings: Warning[] // populated later, by the rule engine — not here
}

/**
 * Structured parse error. Per the privacy-architecture skill, the `message`
 * must describe structure ("JSON parse failed at position 412") and must
 * NEVER include a snippet of the raw pasted input.
 */
export type PlanParseErrorCode =
  | "EMPTY_INPUT"
  | "EMPTY_RESULT"
  | "TRUNCATED_INPUT"
  | "NOT_A_PLAN"
  | "INVALID_JSON"
  | "INVALID_XML"

export class PlanParseError extends Error {
  readonly code: PlanParseErrorCode
  readonly position?: number

  constructor(code: PlanParseErrorCode, message: string, position?: number) {
    super(message)
    this.name = "PlanParseError"
    this.code = code
    this.position = position
  }
}

/**
 * Depth-first walk collecting each node exactly once, deduped by `id`. Plain
 * recursion would double-count a node reachable via more than one parent —
 * Snowflake's multi-parent DAG nodes (see the snowflake-plan-parsing skill)
 * are the case this matters for, but it's harmless (a no-op dedup) for the
 * strict trees Postgres and SQL Server always produce.
 */
export function collectNodes(root: PlanNode): PlanNode[] {
  const result: PlanNode[] = []
  const seen = new Set<string>()
  const walk = (node: PlanNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
    node.children.forEach(walk)
  }
  walk(root)
  return result
}

/**
 * Maps free-text join-type wording (Postgres's `Join Type`, SQL Server's
 * `LogicalOp`, Snowflake's `join_type`) to the shared `JoinLogicalType`
 * vocabulary. Keyword-based rather than an exact-match table since each
 * engine phrases this differently ("Left" vs "LEFT OUTER" vs "Left Outer
 * Join") — returns `undefined` (an honest gap) rather than guessing when
 * nothing recognizable is present.
 */
export function normalizeJoinLogicalType(raw: string | undefined): JoinLogicalType | undefined {
  if (!raw) return undefined
  const text = raw.toLowerCase()
  if (text.includes("full")) return "full_outer"
  if (text.includes("left")) return "left_outer"
  if (text.includes("right")) return "right_outer"
  if (text.includes("anti")) return "anti"
  if (text.includes("semi")) return "semi"
  if (text.includes("cross")) return "cross"
  if (text.includes("inner")) return "inner"
  return undefined
}

/** Only computable when both figures are actually present — never fabricates
 * a ratio from a missing/zero denominator (see field catalog §5). */
export function computeCacheHitRatio(hits: number | undefined, reads: number | undefined): number | undefined {
  if (hits === undefined || reads === undefined || !Number.isFinite(hits) || !Number.isFinite(reads)) return undefined
  const total = hits + reads
  if (total <= 0) return undefined
  return hits / total
}
