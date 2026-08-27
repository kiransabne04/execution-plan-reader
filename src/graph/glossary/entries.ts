// Operator glossary content — first-pass draft (see
// .claude/skills/operator-glossary-content/SKILL.md's "Authoring approach":
// this needs a real DBA review pass before it ships, same discipline as the
// MVP rule set gets in Episode 5). Every entry is general, engine-and-plan-
// independent education about an operator TYPE — never a specific finding
// about one node in one plan.
//
// Coverage: every operatorType returned by any of the three operatorMap.ts
// tables (see plan-normalization skill), confirmed against the actual
// source files, not from memory. "unknown" deliberately has no entry here —
// it always goes through the fallback path (see index.ts).

import type { OperatorGlossaryEntry } from "./types"

const ENTRIES: OperatorGlossaryEntry[] = [
  // ---- Scans ----
  {
    operatorType: "seq_scan",
    displayName: "Sequential Scan",
    shortDefinition: "Reads every row in a table, in whatever order they're physically stored, checking each one against any filter.",
    longDefinition:
      "A sequential scan (also called a table scan or full scan) walks the entire table from start to finish, row by row, applying any filter conditions as it goes. It doesn't use an index at all — there's nothing to look up, just a straight read of everything. This is the simplest possible way to read a table, and for small tables or queries that genuinely need most of the rows, it's often the cheapest option too.",
    whenItsFine: "On a small table, or when a query needs to read most of the table's rows anyway, a sequential scan is often the fastest available plan — an index lookup has its own overhead that isn't worth paying when you're going to read almost everything regardless.",
    whenToLookCloser: "On a large table where only a small fraction of rows actually match the query's filter, a sequential scan means reading (and discarding) far more data than necessary — usually a sign that a suitable index is missing or isn't being used.",
  },
  {
    operatorType: "index_scan",
    displayName: "Index Scan",
    shortDefinition: "Uses an index to find matching rows, then fetches the actual row data for each match.",
    longDefinition:
      "An index scan walks an index structure (typically a B-tree) to find rows matching a condition, then follows a pointer back to the table's actual row data for each match — a step usually called a 'heap fetch' or 'bookmark lookup' depending on the engine. This two-step process is fast when relatively few rows match, since it avoids reading the whole table, but each matched row costs an extra read to fetch its full data.",
    whenItsFine: "When a query matches a small fraction of a table's rows, an index scan reads far less data than a full scan would, and is usually the better choice.",
    whenToLookCloser: "If an index scan is matching a large fraction of the table's rows, the extra per-row fetch cost can actually make it slower than a plain sequential scan would have been — a classic sign of a stale row-count estimate steering the planner toward the wrong choice.",
  },
  {
    operatorType: "index_only_scan",
    displayName: "Index-Only Scan",
    shortDefinition: "Answers the query using only the index itself, without ever touching the underlying table.",
    longDefinition:
      "An index-only scan is possible when every column the query needs is already present in the index — there's no need for the extra step of fetching the full row from the table. This avoids the per-row heap-fetch cost that an ordinary index scan pays, making it one of the fastest ways to satisfy a query when it applies.",
    whenItsFine: "This is close to the best-case outcome for an indexed lookup — if you see it, the index is well-matched to the query's needs.",
    whenToLookCloser: "If you expected this but see a plain index scan instead, the index may be missing an 'included' column the query needs, or the table's visibility map may be too stale for the engine to skip the heap fetch reliably.",
  },
  {
    operatorType: "index_seek",
    displayName: "Index Seek",
    shortDefinition: "Navigates directly to the matching rows in an index using its sorted structure, rather than scanning it end to end.",
    longDefinition:
      "An index seek uses the index's own sorted order to jump straight to the range of rows that match a condition, instead of examining the whole index. This is the seek/scan distinction SQL Server draws explicitly: a seek uses the search condition to narrow down a starting point, while a scan (even of an index) reads through it more broadly. Seeks are typically very fast and are the outcome a well-matched index is designed to produce.",
    whenItsFine: "An index seek returning a small, targeted set of rows is exactly what a good index is for — this is usually a sign of a healthy plan.",
    whenToLookCloser: "A seek that still returns a very large number of rows, or one paired with an expensive Key Lookup for every row, suggests the index covers the search condition but not the rest of the query's needs.",
  },
  {
    operatorType: "bitmap_heap_scan",
    displayName: "Bitmap Heap Scan",
    shortDefinition: "Fetches table rows in physical block order using a bitmap built from one or more indexes, instead of following each index match individually.",
    longDefinition:
      "A bitmap heap scan is the second half of Postgres's bitmap scan strategy: after a Bitmap Index Scan (or a combination of several, via BitmapAnd/BitmapOr) builds a bitmap of which table pages contain matching rows, this step reads those pages in physical order and re-checks the actual row data. Visiting pages in physical order rather than following the index one match at a time reduces random I/O, which matters most when there are many scattered matches.",
    whenItsFine: "When a query matches a moderate-to-large number of rows scattered across the table, this is often more efficient than either a plain index scan (too much random I/O) or a sequential scan (reads everything).",
    whenToLookCloser: "If the underlying bitmap became 'lossy' (tracking whole pages instead of individual rows, usually because it grew larger than the memory budget), every row on a flagged page gets re-checked — worth noticing if this step's actual time looks disproportionate to its row count.",
  },
  {
    operatorType: "bitmap_index_scan",
    displayName: "Bitmap Index Scan",
    shortDefinition: "Reads an index to build a map of which table pages contain matching rows, without fetching the rows themselves yet.",
    longDefinition:
      "A bitmap index scan walks an index and records which table pages (not which specific rows) contain matches, producing a bitmap consumed by a following Bitmap Heap Scan. Because it operates on whole pages rather than individual row pointers, it's well suited to combining multiple indexes' results together (via BitmapAnd/BitmapOr) before ever touching the table.",
    whenItsFine: "This is a normal, healthy building block of the bitmap-scan strategy — it's rarely a target for concern on its own.",
    whenToLookCloser: "If this step's estimated vs. actual row counts differ sharply, that mismatch will propagate into the bitmap and the heap scan that follows it.",
  },
  {
    operatorType: "bitmap_and",
    displayName: "Bitmap AND",
    shortDefinition: "Combines two or more bitmaps from separate index scans, keeping only the pages that appear in all of them.",
    longDefinition:
      "A BitmapAnd intersects the bitmaps produced by two or more Bitmap Index Scan children — the result flags only the table pages that satisfy every one of the combined conditions. This lets the planner effectively use multiple indexes together for a single query, something a plain index scan can't do on its own.",
    whenItsFine: "Combining indexes this way is a genuinely useful technique for multi-condition filters where no single index covers every condition well.",
    whenToLookCloser: "Not applicable in the usual sense — this operator type is known to always report zero actual rows in Postgres regardless of how many rows actually matched, which is an engine quirk, not a real problem.",
  },
  {
    operatorType: "bitmap_or",
    displayName: "Bitmap OR",
    shortDefinition: "Combines two or more bitmaps from separate index scans, keeping any page that appears in at least one of them.",
    longDefinition:
      "A BitmapOr unions the bitmaps produced by two or more Bitmap Index Scan children — typically used when a query's filter is an OR across conditions that each have their own index. The result flags every table page satisfying at least one of the combined conditions.",
    whenItsFine: "This is the standard way Postgres serves an OR'd filter using multiple single-column indexes at once.",
    whenToLookCloser: "Not applicable in the usual sense — like BitmapAnd, this operator type always reports zero actual rows in Postgres by design, which is an engine quirk, not a real problem.",
  },
  {
    operatorType: "tid_scan",
    displayName: "TID Scan",
    shortDefinition: "Fetches specific rows directly by their physical location (tuple ID) rather than by searching an index or scanning the table.",
    longDefinition:
      "A TID (tuple ID) scan retrieves rows using their exact physical address inside the table, bypassing indexes entirely. This is an unusual, narrow-purpose operation — it typically shows up when a query filters directly on the internal `ctid` system column, or as part of certain maintenance operations, rather than in everyday application queries.",
    whenItsFine: "When a query explicitly targets rows by their physical tuple ID, this is simply the correct and only way to do it.",
    whenToLookCloser: "If this appears unexpectedly in an application query you didn't write to reference `ctid` directly, it's worth understanding why — it's not a common access pattern.",
  },
  {
    operatorType: "subquery_scan",
    displayName: "Subquery Scan",
    shortDefinition: "Reads the output of a subquery that the planner couldn't (or chose not to) merge into the surrounding query.",
    longDefinition:
      "A subquery scan is a thin wrapper node that reads rows produced by a nested subquery as if it were a table. Modern query planners often 'flatten' simple subqueries directly into the outer query so this wrapper never appears at all — when it does show up, it usually means the subquery has a feature (like its own LIMIT, or certain aggregate/window function combinations) that prevented that flattening.",
    whenItsFine: "A subquery scan over a small or already-filtered result set has little overhead of its own.",
    whenToLookCloser: "If a subquery scan sits over a much larger subtree than expected, check whether the subquery could be rewritten (e.g. as a JOIN) to let the planner consider more efficient combined strategies.",
  },
  {
    operatorType: "function_scan",
    displayName: "Function Scan",
    shortDefinition: "Runs a set-returning function and treats its output rows as if they came from a table.",
    longDefinition:
      "A function scan executes a function that returns a set of rows (rather than a single value) and feeds those rows into the rest of the plan, similar to scanning a table. Common examples include table-generating functions used directly in a FROM clause, or unnesting an array into rows.",
    whenItsFine: "This is the normal, expected way a set-returning function participates in a query plan.",
    whenToLookCloser: "The planner often has very little real information about how many rows a custom function will return, so a bad row-count estimate here is common and worth checking against the actual count.",
  },
  {
    operatorType: "values_scan",
    displayName: "Values Scan",
    shortDefinition: "Supplies a fixed, literal set of rows written directly into the query, without reading any table.",
    longDefinition:
      "A VALUES scan produces rows from a literal list written directly in the SQL (a `VALUES (...)` clause), rather than from any stored table or index. It's typically a cheap, small, and predictable step in a plan.",
    whenItsFine: "Since the data is a literal list in the query itself, this step is essentially always fine and rarely worth a second look.",
    whenToLookCloser: "Only worth attention if the literal list itself is unexpectedly huge, which would be unusual for how VALUES lists are typically used.",
  },
  {
    operatorType: "cte_scan",
    displayName: "CTE Scan",
    shortDefinition: "Reads the already-computed result of a Common Table Expression (a `WITH` clause), rather than recomputing it.",
    longDefinition:
      "A CTE scan reads rows from a Common Table Expression that was materialized once elsewhere in the plan. If the same CTE is referenced more than once in the query, each reference is its own CTE Scan reading from the same shared, one-time computation — the underlying work isn't repeated per reference.",
    whenItsFine: "This is the standard, efficient way a CTE's result gets reused across multiple references in the same query.",
    whenToLookCloser: "If the CTE's own computation (found elsewhere in the plan, often tagged as an InitPlan) turned out much larger than expected, that cost is shared across every CTE Scan referencing it — worth checking the source computation, not just this read of it.",
  },
  {
    operatorType: "named_tuplestore_scan",
    displayName: "Named Tuplestore Scan",
    shortDefinition: "Reads rows from a temporary, named set of rows supplied by the surrounding execution context, not from a stored table.",
    longDefinition:
      "This scan reads from a 'named tuplestore' — a specially-provided, temporary row set most commonly seen as the OLD/NEW transition tables available inside an AFTER trigger on a data-modifying statement. It's a narrow, specific-purpose operator rather than something that shows up in typical read queries.",
    whenItsFine: "When it appears inside a trigger referencing transition tables, this is exactly the expected way those rows get read.",
    whenToLookCloser: "Outside of a trigger context, this operator wouldn't be expected — its presence is a strong hint about what kind of statement produced the plan.",
  },
  {
    operatorType: "worktable_scan",
    displayName: "WorkTable Scan",
    shortDefinition: "Reads the results computed by the previous iteration of a recursive query, feeding the next round of recursion.",
    longDefinition:
      "A WorkTable Scan is specific to recursive CTEs (`WITH RECURSIVE`): it reads the rows produced by the prior iteration so the recursive term can build on them, repeating until an iteration produces no new rows. It always appears paired with a Recursive Union driving the overall recursion.",
    whenItsFine: "This is simply how recursive CTE execution works — its presence isn't itself a concern.",
    whenToLookCloser: "If a recursive query is running far more iterations than expected (visible as a high loop or execution count feeding this step), check the recursive termination condition — a query that should converge quickly but doesn't often has a logic issue in the recursive term.",
  },
  {
    operatorType: "foreign_scan",
    displayName: "Foreign Scan",
    shortDefinition: "Reads data from a table that actually lives on a different, external data source, via a foreign data wrapper.",
    longDefinition:
      "A foreign scan retrieves rows from a table defined through Postgres's foreign data wrapper (FDW) mechanism — the actual data lives in another database or system entirely, and this operator handles fetching it, potentially pushing some filtering work down to the remote source depending on the specific wrapper's capabilities.",
    whenItsFine: "When the foreign wrapper can push filtering and even joins down to the remote source, this can be quite efficient — the plan node itself just represents wherever that boundary landed.",
    whenToLookCloser: "If a foreign scan appears to be pulling large amounts of data with no pushed-down filtering, most of the real cost is happening on the remote side and outside what this plan alone can show you.",
  },
  {
    operatorType: "custom_scan",
    displayName: "Custom Scan",
    shortDefinition: "A scan implemented by a database extension rather than Postgres's built-in scan types.",
    longDefinition:
      "A custom scan is a pluggable extension point: third-party extensions can register their own specialized scan implementations (for example, a columnar storage engine or a specialized indexing scheme) that the planner can choose to use like any built-in scan type. What actually happens under the hood depends entirely on which extension provided it.",
    whenItsFine: "If you're intentionally using an extension that provides a custom scan, this is simply that extension doing its job.",
    whenToLookCloser: "Since behavior varies by extension, understanding what's actually happening usually requires checking that specific extension's own documentation rather than general plan-reading intuition.",
  },
  // ---- Seeks, lookups, and other targeted-read operators ----
  {
    operatorType: "key_lookup",
    displayName: "Key Lookup",
    shortDefinition: "Fetches the remaining columns for a row from the main table, after a seek on a non-covering index found the row.",
    longDefinition:
      "A Key Lookup (SQL Server's term; also called a bookmark or RID lookup in older contexts) happens when an index seek finds matching rows but the index doesn't contain every column the query needs — so an extra lookup fetches the rest from the table itself, once per matched row. This is functionally similar to what other engines call a heap fetch after an index scan.",
    whenItsFine: "For a small number of matched rows, the extra per-row lookup cost is usually negligible next to the benefit of a targeted seek.",
    whenToLookCloser: "When a Key Lookup executes a very large number of times (once per row from an upstream seek), that per-row cost adds up fast — a classic sign that a covering index (one including the extra needed columns) would help.",
  },
  // ---- Joins ----
  {
    operatorType: "nested_loop_join",
    displayName: "Nested Loop Join",
    shortDefinition: "For each row from one input, searches the other input for matches — repeating the search once per outer row.",
    longDefinition:
      "A nested loop join takes each row from its outer (driving) input and, for every one, searches the inner input for matching rows — conceptually like a loop within a loop. It needs no extra memory and works well when the outer side is small and the inner side can be searched cheaply (typically via an index), but its cost scales with outer-row-count times per-search-cost, which can grow quickly if either side is misjudged.",
    whenItsFine: "When the outer side has few rows and the inner side has a good index to search with, this is often the fastest join strategy available — cheap per iteration, and there are few iterations.",
    whenToLookCloser: "When the outer side turns out to have far more rows than expected, or the inner side's search isn't backed by an index, this pattern gets expensive fast — cheap per iteration but repeated so many times that the total adds up to a lot.",
  },
  {
    operatorType: "hash_join",
    displayName: "Hash Join",
    shortDefinition: "Builds an in-memory hash table from one input, then probes it with rows from the other input to find matches.",
    longDefinition:
      "A hash join builds a hash table in memory from the smaller ('build') input, keyed on the join columns, then streams rows from the other ('probe') input through it, using the hash table to find matches quickly. It doesn't require either input to be sorted, and generally scales well — but if the build side is larger than the memory budget allows, it has to spill batches to disk, which is significantly slower.",
    whenItsFine: "For joining two reasonably large inputs with no existing sort order, this is usually the most efficient available strategy — and it stays efficient as long as the build side fits comfortably in memory.",
    whenToLookCloser: "If the hash table's build side was bigger than expected and spilled to disk, or if the memory budget is undersized for the actual data volume, this join can become considerably slower than its in-memory case.",
  },
  {
    operatorType: "merge_join",
    displayName: "Merge Join",
    shortDefinition: "Walks two already-sorted inputs side by side, advancing whichever pointer is behind, to find matches in one pass.",
    longDefinition:
      "A merge join takes two inputs that are both sorted on the join key and walks through them together like merging two sorted lists, advancing whichever side is 'behind' at each step. Because it relies on sorted input, it often needs an explicit Sort step beforehand unless the data was already sorted (e.g. coming from an index scan) — the join itself is then a single efficient pass.",
    whenItsFine: "When both inputs are already sorted on the join key (often via an index), a merge join can be very efficient with minimal memory use.",
    whenToLookCloser: "If a merge join required expensive Sort steps on one or both sides purely to enable it, a hash join might have been cheaper overall — worth comparing the total cost including those sorts, not just the join step alone.",
  },
  {
    operatorType: "hash",
    displayName: "Hash",
    shortDefinition: "Builds the in-memory hash table that a Hash Join above it will probe — the 'build side' preparation step.",
    longDefinition:
      "This operator represents the build phase of a hash join: it reads its child's rows and constructs a hash table keyed on the join column, which the Hash Join operator then probes with rows from the other side. Its cost and memory usage scale with the size of whichever input was chosen as the (ideally smaller) build side.",
    whenItsFine: "A Hash node building from a small, well-estimated input is exactly the expected, efficient case.",
    whenToLookCloser: "If this step's actual row count came in far above the estimate, the hash table ends up much larger than planned for — worth checking whether it ended up spilling to disk as a result.",
  },
  {
    operatorType: "join",
    displayName: "Join",
    shortDefinition: "Combines rows from two inputs based on a matching condition — the specific algorithm used isn't exposed at this level.",
    longDefinition:
      "This is a generic join operator where the underlying execution strategy (hash-based, sorted-merge, or otherwise) isn't surfaced separately from the operator type itself. The logical join type (inner, left outer, and so on) is a related but separate piece of information, shown alongside this operator when available.",
    whenItsFine: "A join combining two well-filtered, appropriately-sized inputs is simply normal query execution.",
    whenToLookCloser: "As with any join, output row counts far exceeding either input's size are worth a look — that pattern usually points to a missing or too-loose join condition.",
  },
  {
    operatorType: "cartesian_join",
    displayName: "Cartesian Join",
    shortDefinition: "Pairs every row from one input with every row from the other, with no matching condition to narrow the result.",
    longDefinition:
      "A Cartesian (cross) join produces every possible combination of rows from its two inputs — if the inputs have M and N rows, the output has M×N rows. This is sometimes intentional (a genuine cross join), but far more often it's the accidental result of a missing or incorrectly-written join condition, and its output size grows multiplicatively as input sizes grow.",
    whenItsFine: "When a cross join is genuinely intended (e.g. generating all combinations of a small, deliberately unfiltered set), this is simply the correct tool for that job.",
    whenToLookCloser: "An unintended Cartesian join is one of the most common causes of a query that returns a wildly inflated row count — check the join condition carefully whenever this shows up unexpectedly.",
  },
  // ---- Sort, aggregation, and grouping ----
  {
    operatorType: "sort",
    displayName: "Sort",
    shortDefinition: "Orders the rows it receives according to one or more columns, needed either for the query's own ORDER BY or by another operator downstream.",
    longDefinition:
      "A sort operator arranges its input rows into a specified order — sometimes directly because the query asked for it (`ORDER BY`), and sometimes because another operator further up the plan needs sorted input to work (a merge join or a grouped aggregate, for instance). If the data fits in the available memory it sorts in place; if not, it spills intermediate runs to disk and merges them, which is considerably slower.",
    whenItsFine: "Sorting a small-to-moderate amount of data that comfortably fits in memory is a routine, inexpensive step.",
    whenToLookCloser: "A sort that spills to disk is usually a meaningful cost — check whether the memory allowed for sorting is undersized for the actual data volume being sorted.",
  },
  {
    operatorType: "sort_with_limit",
    displayName: "Sort With Limit (Top-N Sort)",
    shortDefinition: "Sorts data while keeping only the top N rows needed, avoiding the cost of fully sorting everything else.",
    longDefinition:
      "This is an optimization applied when a query sorts data but only needs a limited number of rows from the front of that order (an `ORDER BY ... LIMIT N` pattern). Rather than sorting the entire input and then discarding all but the first N rows, the engine can maintain just the current best N candidates as it scans, which is far cheaper when the input is large and N is small.",
    whenItsFine: "This is strictly better than a full sort followed by a separate limit whenever it applies — seeing it is a good sign, not a concern.",
    whenToLookCloser: "If N is a large fraction of the total row count, the benefit over a full sort shrinks — worth noting if the LIMIT value seems unexpectedly high relative to the data size.",
  },
  {
    operatorType: "aggregate",
    displayName: "Aggregate",
    shortDefinition: "Computes summary values (like counts, sums, or averages) across groups of rows, or across all rows if there's no grouping.",
    longDefinition:
      "An aggregate operator computes one or more summary functions (COUNT, SUM, AVG, MIN/MAX, and similar) over its input, either producing a single overall result or one result per group when a GROUP BY is involved. The specific strategy used to form those groups (sorting the input first, or building a hash table keyed by group) is often exposed as its own more specific operator type (Group Aggregate / Hash Aggregate) rather than this generic form.",
    whenItsFine: "Aggregating a well-filtered input down to a much smaller result set is exactly what this operator is for, and is normally cheap relative to the work of producing its input.",
    whenToLookCloser: "If the number of distinct groups turns out to be far larger than expected, memory usage and cost can grow well beyond what the planner anticipated.",
  },
  {
    operatorType: "hash_aggregate",
    displayName: "Hash Aggregate",
    shortDefinition: "Groups rows by building an in-memory hash table keyed on the grouping columns, without needing the input pre-sorted.",
    longDefinition:
      "A hash aggregate forms groups by hashing each row's grouping-column values and accumulating running totals per group in memory — it doesn't require its input to arrive in any particular order, unlike a group aggregate. This makes it flexible and often fast, provided the number of distinct groups (and thus the hash table's size) stays within the available memory.",
    whenItsFine: "When the number of distinct groups is modest and fits comfortably in memory, this is usually the most efficient grouping strategy, since it avoids a separate sort step entirely.",
    whenToLookCloser: "If the actual number of distinct groups vastly exceeds the estimate, the hash table can outgrow its memory budget — worth checking whether that happened and whether it spilled as a result.",
  },
  {
    operatorType: "group_aggregate",
    displayName: "Group Aggregate (Sorted)",
    shortDefinition: "Groups rows that are already sorted by the grouping columns, accumulating each group's summary as it goes.",
    longDefinition:
      "A group aggregate (Postgres calls this GroupAggregate; SQL Server calls the equivalent Stream Aggregate) relies on its input already being sorted by the grouping columns, then walks through it once, closing out and emitting each group's summary as soon as it sees the next group begin. Because it depends on sorted input, it's often paired with a Sort step beforehand, unless the sort order came for free from an index.",
    whenItsFine: "When the input is already sorted for another reason (e.g. it came from an index scan), this avoids the extra memory a hash-based grouping approach would need.",
    whenToLookCloser: "If a Sort was added specifically to enable this grouping strategy, it's worth comparing whether a hash-based aggregate (no sort required) might have been cheaper overall for this particular data shape.",
  },
  {
    operatorType: "hash_distinct",
    displayName: "Hash Distinct",
    shortDefinition: "Removes duplicate rows by hashing each one and keeping only the first row seen for each distinct hash value.",
    longDefinition:
      "This operator implements a DISTINCT (or similar deduplication need) by hashing each row and tracking which hash values have already been seen, emitting a row only the first time its value appears. Like other hash-based operators, it doesn't require sorted input but does need memory proportional to the number of distinct values.",
    whenItsFine: "For a moderate number of distinct values, this is a fast, single-pass way to deduplicate without needing a sort first.",
    whenToLookCloser: "If the number of distinct values is very large, memory pressure can become a real factor — similar to any other hash-based operator.",
  },
  {
    operatorType: "hash_union",
    displayName: "Hash Union",
    shortDefinition: "Combines rows from two inputs while removing duplicates, using a hash table to track which rows have already appeared.",
    longDefinition:
      "This operator implements a UNION (the deduplicating kind, as opposed to UNION ALL) using a hash-based approach: it reads rows from both inputs and uses a hash table to ensure only distinct rows make it to the output. It combines the row-combining behavior of an Append with the deduplication behavior of a Hash Distinct.",
    whenItsFine: "This is the normal execution strategy for a UNION where the inputs' combined distinct-value count is modest.",
    whenToLookCloser: "As with any hash-based deduplication, a very large number of distinct combined rows increases memory pressure.",
  },
  {
    operatorType: "window_agg",
    displayName: "Window Function",
    shortDefinition: "Computes a value for each row based on a window of related rows (like a running total or rank), without collapsing rows into groups.",
    longDefinition:
      "A window function operator computes calculations like running totals, rankings, or moving averages across a defined 'window' of rows related to the current one (e.g. rows with the same value in a PARTITION BY column) — unlike a regular aggregate, it doesn't reduce the number of output rows; every input row still produces one output row, now with the computed value attached. It typically requires its input sorted appropriately for the window's ORDER BY.",
    whenItsFine: "This is simply how window functions execute — its presence is expected whenever a query uses one.",
    whenToLookCloser: "If a Sort was introduced specifically to support the window's ordering and that sort is expensive, it's worth checking whether an existing index could provide that order for free.",
  },
  {
    operatorType: "group",
    displayName: "Group",
    shortDefinition: "Collapses consecutive rows that share the same grouping-column values into one, without necessarily computing any aggregate function.",
    longDefinition:
      "A Group node identifies runs of consecutive rows (in already-sorted input) that share the same values in the grouping columns and collapses each run to a single representative row. It's related to a Group Aggregate but is used specifically when no aggregate function needs to be computed — just the distinct grouping itself.",
    whenItsFine: "This is a lightweight operation when it applies, since it doesn't need to accumulate any aggregate state per group.",
    whenToLookCloser: "As with any operator relying on sorted input, check whether the required sort was already available for free or had to be computed specially for this step.",
  },
  {
    operatorType: "unique",
    displayName: "Unique",
    shortDefinition: "Removes duplicate rows from already-sorted input by comparing each row to the one before it.",
    longDefinition:
      "A Unique operator deduplicates rows that arrive already sorted, by simply comparing each row to its immediate predecessor and skipping it if they match — an efficient approach precisely because sorted order guarantees any duplicates are adjacent. This is typically how DISTINCT is implemented when the input is already sorted for another reason.",
    whenItsFine: "When the input was already sorted anyway (e.g. for an ORDER BY or an index scan), this is an essentially free way to deduplicate.",
    whenToLookCloser: "If a Sort was added purely to enable this deduplication approach, a hash-based distinct might have avoided that sort's cost entirely — worth comparing for this specific data shape.",
  },
  {
    operatorType: "set_op",
    displayName: "Set Operation",
    shortDefinition: "Combines two inputs using set logic like INTERSECT or EXCEPT, based on rows that are already sorted and comparable.",
    longDefinition:
      "A set operation node implements SQL's INTERSECT or EXCEPT (also known as MINUS in some engines) by comparing rows from two sorted inputs and keeping only those that satisfy the requested set relationship — present in both inputs for INTERSECT, or present in the first but not the second for EXCEPT.",
    whenItsFine: "This is simply the standard execution strategy for these set operations when the inputs are sorted appropriately.",
    whenToLookCloser: "As with merge-style operators generally, check whether the sorts feeding into this step were already available or added specifically to enable it.",
  },
  // ---- Limiting, appending, and result shaping ----
  {
    operatorType: "limit",
    displayName: "Limit",
    shortDefinition: "Stops producing rows once a requested count has been reached, corresponding to a query's LIMIT/TOP/FETCH clause.",
    longDefinition:
      "A limit operator caps the number of rows passed up from its child, stopping early once that count is satisfied — corresponding directly to a `LIMIT`/`TOP`/`FETCH FIRST` clause in the query. Because it can stop its child early, a limit paired with an appropriately-ordered input (e.g. via an index) can be extremely fast even over a huge table, since it never needs to touch rows beyond what it returns.",
    whenItsFine: "A limit sitting over an operation that can produce rows in the needed order incrementally (like an index scan) is typically very efficient.",
    whenToLookCloser: "If the child operation has to fully materialize or sort a large amount of data before the limit can apply, the limit itself doesn't save much — the expensive work already happened underneath it.",
  },
  {
    operatorType: "append",
    displayName: "Append",
    shortDefinition: "Concatenates rows from two or more child inputs into a single stream, without removing duplicates.",
    longDefinition:
      "An append operator combines the output of multiple children end-to-end into one result set, most commonly implementing `UNION ALL` or reading across the partitions of a partitioned table. Since it doesn't deduplicate, it's typically cheaper than a Union — each child's rows just get passed through as they arrive.",
    whenItsFine: "This is the normal, efficient way both UNION ALL and partitioned-table scans get executed.",
    whenToLookCloser: "If an Append is scanning far more partitions than the query's filter should require, partition pruning may not be working as expected for this particular query shape.",
  },
  {
    operatorType: "merge_append",
    displayName: "Merge Append",
    shortDefinition: "Combines rows from multiple already-sorted children while preserving overall sort order across all of them.",
    longDefinition:
      "A merge append is like an Append, but specifically for the case where the query needs its overall result sorted and each child input is already individually sorted (often each a partition of a partitioned table) — it merges them together the way a merge join merges two sides, preserving global order without needing a separate full sort afterward.",
    whenItsFine: "This lets a partitioned table satisfy an ORDER BY efficiently without a separate expensive sort step over the combined result.",
    whenToLookCloser: "If a plain Append plus a full Sort appears instead where this seems like it should apply, check whether each partition's individual sort order actually lines up with what the query needs.",
  },
  {
    operatorType: "recursive_union",
    displayName: "Recursive Union",
    shortDefinition: "Drives a recursive CTE by repeatedly running its recursive part against the previous iteration's results until nothing new appears.",
    longDefinition:
      "A recursive union implements `WITH RECURSIVE`: it runs the CTE's non-recursive starting query once, then repeatedly re-runs the recursive part using the previous round's output (read via a WorkTable Scan) as input, accumulating results until an iteration produces no new rows.",
    whenItsFine: "This is simply how recursive CTEs execute — normal and expected whenever one is used.",
    whenToLookCloser: "If the recursion runs far more iterations than the data's logical depth should require, the recursive termination condition may not be behaving as intended.",
  },
  {
    operatorType: "result",
    displayName: "Result",
    shortDefinition: "Produces a small, often constant or computed result with no table access at all, such as `SELECT 1` or a computed expression.",
    longDefinition:
      "A Result node computes and returns values that don't require reading from any table — a literal SELECT, a computed expression, or sometimes a filter condition that the planner has already determined is always false (in which case it appears with no rows produced at all, a valid and efficient way to short-circuit a query).",
    whenItsFine: "This is an inherently lightweight step, and its presence is completely normal for any query that doesn't need to touch a table.",
    whenToLookCloser: "Not typically a concern on its own — it's usually the cheapest node in any plan it appears in.",
  },
  {
    operatorType: "project_set",
    displayName: "Project Set",
    shortDefinition: "Evaluates one or more set-returning functions in a query's SELECT list, producing multiple output rows per input row.",
    longDefinition:
      "A project set handles set-returning functions (like `unnest()`) that appear directly in a query's target list rather than its FROM clause — each input row can expand into multiple output rows, one per value the function returns for that row.",
    whenItsFine: "This is the expected mechanism whenever a set-returning function is used in a SELECT list.",
    whenToLookCloser: "Since the planner often can't predict how many rows a given function call will expand into, a mismatched row-count estimate here is common and worth checking against the actual count if this step feeds into something cost-sensitive downstream.",
  },
  {
    operatorType: "materialize",
    displayName: "Materialize",
    shortDefinition: "Caches its child's full output in memory (or on disk if needed), so it can be re-read multiple times without recomputing it.",
    longDefinition:
      "A materialize node runs its child once, stores every row it produces, and then serves that stored copy to whatever reads from it — useful when the same intermediate result needs to be scanned repeatedly, most commonly on the inner side of a nested loop join where re-running the child for every outer row would be wasteful.",
    whenItsFine: "When the underlying data is small and read multiple times, caching it this way is a clear efficiency win over recomputing it from scratch each time.",
    whenToLookCloser: "If the materialized data set turns out to be large, both the memory (or disk) it consumes and the one-time cost of producing it become worth paying attention to.",
  },
  {
    operatorType: "memoize",
    displayName: "Memoize",
    shortDefinition: "Caches results keyed by input parameter value, so a repeated lookup for the same value can be served from cache instead of recomputed.",
    longDefinition:
      "A memoize node sits on the inner side of a nested loop join and remembers results per distinct parameter value coming from the outer side — if the outer side repeats the same value, the cached result is reused instead of re-running the inner side's search again. This is most valuable when the outer side has many rows but relatively few distinct values feeding the inner search.",
    whenItsFine: "When the outer side has a lot of row repetition in its join-key values, this can turn what would be many redundant inner searches into far fewer actual ones.",
    whenToLookCloser: "If the outer side's values are nearly all distinct, the cache has little chance to help and mostly just adds bookkeeping overhead — worth checking the cache hit rate if this shows up somewhere unexpected.",
  },
  // ---- Parallelism ----
  {
    operatorType: "gather",
    displayName: "Gather",
    shortDefinition: "Collects rows produced by multiple parallel worker processes back into a single stream for the rest of the plan.",
    longDefinition:
      "A gather operator marks the point where results from parallel workers — each running a copy of the same subplan on a portion of the data — get combined back into one sequential stream for whatever comes next. The workers' individual timings are reported separately per worker; the numbers on this operator and its subtree can look substantially different from what a single-worker plan would show, since work is happening concurrently across several processes.",
    whenItsFine: "Parallel execution splitting real work across multiple workers is usually a genuine performance win for large scans and aggregations.",
    whenToLookCloser: "Any timing figures under a Gather are cumulated across all the workers, not a single execution's wall-clock time — comparing them directly to a non-parallel node's timing can make a perfectly fine parallel plan look misleadingly slow.",
  },
  {
    operatorType: "gather_merge",
    displayName: "Gather Merge",
    shortDefinition: "Collects rows from multiple parallel workers while preserving a shared sort order across all of them, unlike a plain Gather.",
    longDefinition:
      "A gather merge is like a Gather, but for the case where each worker's output is already sorted and the combined result needs to preserve that overall order — it merges the workers' streams together the way a merge join merges two sides, rather than concatenating them in whatever order they happen to finish.",
    whenItsFine: "This lets a query needing sorted results still benefit from parallel execution, without a separate full sort over the combined output afterward.",
    whenToLookCloser: "Same cumulated-timing caveat as a plain Gather — the numbers reported reflect multiple concurrent workers, not one single-threaded execution.",
  },
  {
    operatorType: "exchange",
    displayName: "Exchange",
    shortDefinition: "Redistributes or collects rows between parallel execution threads, without doing any filtering or transformation itself.",
    longDefinition:
      "An exchange operator moves data between the parallel threads working on a query — gathering results from multiple threads into one, or redistributing rows across threads so each can work on its own share of the data. It's SQL Server's general term for this family of parallelism-coordination steps.",
    whenItsFine: "Exchange operators are a normal, expected part of any parallel execution plan — their presence simply reflects the query running across multiple threads.",
    whenToLookCloser: "As with any parallel operator, per-thread timing figures here are summed across threads rather than reflecting a single thread's wall-clock time — worth keeping that in mind before comparing timings directly to a non-parallel plan.",
  },
  // ---- Locking and data modification ----
  {
    operatorType: "lock_rows",
    displayName: "Lock Rows",
    shortDefinition: "Acquires row-level locks on the rows a query is about to return, implementing `SELECT ... FOR UPDATE` or `FOR SHARE`.",
    longDefinition:
      "A lock rows operator takes the rows selected by the rest of the plan and locks each one before returning it, as requested by a `FOR UPDATE`/`FOR SHARE`-style clause. This ensures the locked rows can't be modified by another concurrent transaction until the current one finishes, at the cost of a small amount of per-row locking overhead.",
    whenItsFine: "For a query that genuinely needs to lock a modest number of rows before modifying them, this is simply the correct, expected mechanism.",
    whenToLookCloser: "If this is locking a very large number of rows, or contending with other transactions frequently, it can become a source of blocking elsewhere in the system — worth considering whether the lock scope could be narrowed.",
  },
  {
    operatorType: "modify_table",
    displayName: "Modify Table (Insert / Update / Delete / Merge)",
    shortDefinition: "Applies an INSERT, UPDATE, DELETE, or MERGE to a table, writing the changes computed by the rest of the plan.",
    longDefinition:
      "This operator represents the actual data-modification step of an INSERT, UPDATE, DELETE, or MERGE statement — everything else in the plan computes which rows to affect and what their new values should be, and this step writes those changes. Its cost includes not just the write itself but often index maintenance and trigger execution as a consequence.",
    whenItsFine: "For a modification affecting a reasonable, expected number of rows, this step's cost usually scales predictably with that row count.",
    whenToLookCloser: "If this is modifying far more rows than expected, both the direct write cost and any triggers or index updates it cascades into are worth considering — the visible plan cost is often just part of the real picture for a large write.",
  },
  // ---- SQL-Server-specific operators ----
  {
    operatorType: "filter",
    displayName: "Filter",
    shortDefinition: "Discards rows that don't satisfy a condition, passing through only the ones that do.",
    longDefinition:
      "A filter operator evaluates a condition against each incoming row and only passes through the ones that satisfy it. It's a distinct operator (rather than folded into a scan) when the condition can't be evaluated as part of the scan or seek itself — for instance, a condition that isn't satisfied by an index being used for something else.",
    whenItsFine: "A filter discarding a modest fraction of its input is a normal, inexpensive part of query execution.",
    whenToLookCloser: "If a filter is discarding the vast majority of the rows it receives, that's often a sign an index could apply the same condition earlier and cheaper, before all those rows were read in the first place.",
  },
  {
    operatorType: "compute_scalar",
    displayName: "Compute Scalar",
    shortDefinition: "Evaluates an expression (like a calculation or a function call) for each row, adding the result as a new column.",
    longDefinition:
      "A compute scalar operator evaluates a scalar expression — arithmetic, a function call, a CASE expression, and similar — once per row, typically to produce a computed column used later in the plan (in a SELECT list, an ORDER BY, or a subsequent condition).",
    whenItsFine: "This is a normal, typically inexpensive step for straightforward expressions.",
    whenToLookCloser: "If the expression involves an expensive function call executed once per row over a large input, that per-row cost can add up meaningfully — worth checking what the expression is actually computing.",
  },
  {
    operatorType: "bitmap",
    displayName: "Bitmap Filter",
    shortDefinition: "Builds a compact filter from one side of a join, letting the other side skip rows that couldn't possibly match before the join itself runs.",
    longDefinition:
      "SQL Server's Bitmap operator builds a probabilistic filter (a bloom-filter-like structure) from the values on one side of a join and applies it to the other side early, letting obviously-non-matching rows be discarded before the more expensive join step ever sees them. This is a distinct concept from Postgres's BitmapAnd/BitmapOr, which combine index results rather than filter join inputs.",
    whenItsFine: "When one side of a join can be pre-filtered this way, it often meaningfully reduces the amount of data the join itself has to process.",
    whenToLookCloser: "This operator's benefit depends entirely on how selective the resulting filter turns out to be — if it isn't eliminating many rows, it added overhead without much payoff.",
  },
  {
    operatorType: "spool",
    displayName: "Spool",
    shortDefinition: "Temporarily stores a copy of its input rows (in tempdb or memory) so they can be re-read multiple times without recomputing them.",
    longDefinition:
      "A spool operator captures its child's output into a temporary work table and serves reads from that stored copy — conceptually similar to Postgres's Materialize. SQL Server distinguishes several spool variants (table spool, index spool, row count spool) depending on exactly how the temporary data is structured and used, most commonly to avoid re-executing an expensive subtree multiple times, such as on the inner side of a nested loop.",
    whenItsFine: "When the same intermediate data needs to be read multiple times, storing it once here is usually cheaper than recomputing the underlying subtree repeatedly.",
    whenToLookCloser: "If the spooled data set is large, both the cost of building it once and the tempdb space it occupies are worth factoring into the overall picture.",
  },
  // ---- Snowflake-specific operators ----
  {
    operatorType: "with_clause",
    displayName: "With Clause (CTE Materialization)",
    shortDefinition: "Computes and materializes a Common Table Expression's result once, so it can be referenced multiple times without recomputation.",
    longDefinition:
      "A With Clause operator represents the one-time computation of a CTE's defining query in Snowflake — if the same CTE is referenced from more than one place in the query, this single materialization is shared across all of them (each reference shows up as its own WithReference operator reading from it), rather than the underlying query being re-run per reference.",
    whenItsFine: "This is the standard, efficient way a CTE referenced multiple times gets computed exactly once and reused.",
    whenToLookCloser: "If this computation turns out to be far more expensive than expected, that cost is shared by every downstream reference to it — worth examining as the shared root cause rather than each reference individually.",
  },
  {
    operatorType: "flatten",
    displayName: "Flatten",
    shortDefinition: "Expands semi-structured data (a VARIANT, ARRAY, or OBJECT column) into multiple rows, one per element.",
    longDefinition:
      "Flatten is Snowflake's operator for exploding a semi-structured value — commonly a JSON array or object stored in a VARIANT column — into a separate row per element or key/value pair. There's no direct equivalent to this operator in Postgres or SQL Server's plan vocabulary, since it's tied specifically to Snowflake's native semi-structured data handling.",
    whenItsFine: "This is simply the standard mechanism for querying into nested semi-structured data in Snowflake.",
    whenToLookCloser: "If the semi-structured values being flattened are unexpectedly large or deeply nested, the resulting row explosion can be much bigger than anticipated.",
  },
  {
    operatorType: "grouping_sets",
    displayName: "Grouping Sets",
    shortDefinition: "Computes multiple different groupings of the same data in one pass, as requested by GROUPING SETS, ROLLUP, or CUBE.",
    longDefinition:
      "A grouping sets operator produces the combined result of several different GROUP BY groupings at once — for example, a ROLLUP computing subtotals at multiple levels of a hierarchy plus a grand total, all from one query. It's a more general operator than a single-level Aggregate, since it accounts for the fact that multiple grouping combinations are being computed together.",
    whenItsFine: "For genuinely needing several related groupings at once (subtotal reports, for instance), this is far more efficient than running separate aggregate queries for each grouping.",
    whenToLookCloser: "The more distinct grouping combinations requested, the more work this step represents — worth checking if a query only actually needs a subset of what ROLLUP/CUBE would otherwise compute.",
  },
  {
    operatorType: "external_function",
    displayName: "External Function",
    shortDefinition: "Calls out to an external service or API to compute a value, once per row (or per batch of rows).",
    longDefinition:
      "An external function operator invokes code running outside Snowflake entirely — typically a cloud function — to compute a result, batching rows together for the call where possible. Because this involves genuine network round-trips to an external system, its performance characteristics are quite different from every other operator in this glossary, most of which represent purely local computation.",
    whenItsFine: "For workloads that genuinely need external computation (calling a machine learning model, for instance), this is the intended mechanism.",
    whenToLookCloser: "Network latency to the external service, not local compute, usually dominates this operator's cost — worth checking whether rows are being batched efficiently into fewer, larger calls rather than many small ones.",
  },
  {
    operatorType: "generator",
    displayName: "Generator",
    shortDefinition: "Produces a specified number of synthetic rows out of nothing, rather than reading them from any table.",
    longDefinition:
      "A generator operator manufactures rows programmatically — commonly used via Snowflake's `GENERATOR(ROWCOUNT => ...)` table function to produce a specific quantity of rows for testing, seeding, or numbering purposes, with no underlying table being read at all.",
    whenItsFine: "This is exactly the intended use whenever a query deliberately needs a specific quantity of synthetic rows.",
    whenToLookCloser: "Not typically a performance concern on its own, since it's a lightweight, purely synthetic row source.",
  },
]

export default ENTRIES
