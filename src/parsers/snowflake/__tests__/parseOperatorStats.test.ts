import { describe, expect, it } from "vitest"
import { parseSnowflakeOperatorStats } from "../index"
import { PlanParseError, collectNodes } from "../../normalize"
import { loadFixture } from "./testUtils"

// collectNodes dedupes by id, exactly what a multi-parent DAG node (a shared
// reference appearing under more than one parent) needs: counted once, not
// once per parent.
const collect = collectNodes

describe("parseSnowflakeOperatorStats", () => {
  it("parses a single-operator plan and promotes output_rows", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("simple-table-scan.json"))
    expect(root.engine).toBe("snowflake")
    expect(root.rawOperatorLabel).toBe("TableScan")
    expect(root.operatorType).toBe("seq_scan")
    expect(root.actualRows).toBe(1000000)
    expect(root.attributes["attr.table_name"]).toBe("MY_DB.PUBLIC.ORDERS")
    // Execution time breakdown preserved per-component, not flattened.
    expect(root.attributes["time.processing"]).toBe(80)
    expect(root.attributes["time.local_disk_io"]).toBe(15)
    expect(root.attributes["time.overall_percentage"]).toBe(100)
  })

  // Re-verifying docs/11-manual-testing-gaps-episode8.md's Gap 3 against
  // Snowflake surfaced a real gap: the same breakdown data above was only
  // ever reaching the raw attributes bag, never the normalized field the
  // detail panel actually reads (buildStatRows.ts works off typed PlanNode
  // fields, not attribute keys) — so Snowflake nodes silently never got a
  // Time row in the panel at all. Fixed by promoting it to `timeBreakdown`.
  it("promotes execution time breakdown to the normalized timeBreakdown field the detail panel reads", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("simple-table-scan.json"))
    expect(root.timeBreakdown?.overallPercentage).toBe(100)
    expect(root.timeBreakdown?.processingPercentage).toBe(80)
    expect(root.timeBreakdown?.localDiskIoPercentage).toBe(15)
    // Snowflake never reports a comparable actualTimeMs figure (field
    // catalog §7) — timeBreakdown is the honest equivalent, not a stand-in.
    expect(root.actualTimeMs).toBeUndefined()
  })

  it("reconstructs a multi-level tree from flat ID/parent references", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("join-filter-aggregate.json"))
    expect(root.rawOperatorLabel).toBe("Aggregate")
    expect(root.children).toHaveLength(1)
    const join = root.children[0]
    expect(join.rawOperatorLabel).toBe("Join")
    expect(join.operatorType).toBe("join")
    expect(join.children).toHaveLength(2)
    const labels = join.children.map((c) => c.rawOperatorLabel).sort()
    expect(labels).toEqual(["Filter", "TableScan"])
    const filter = join.children.find((c) => c.rawOperatorLabel === "Filter")!
    expect(filter.children).toHaveLength(1)
    expect(filter.children[0].rawOperatorLabel).toBe("TableScan")
  })

  it("handles a multi-parent operator (WithClause) without dropping or duplicating data", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("multi-parent-with-clause.json"))
    expect(root.rawOperatorLabel).toBe("UnionAll")
    expect(root.children).toHaveLength(2)
    const [branchA, branchB] = root.children
    expect(branchA.children).toHaveLength(1)
    expect(branchB.children).toHaveLength(1)
    const withClauseViaA = branchA.children[0]
    const withClauseViaB = branchB.children[0]
    // Same operator (same id), reachable via both parents — linked, not
    // duplicated: it's the exact same object, not two independent copies.
    expect(withClauseViaA.id).toBe("1")
    expect(withClauseViaB.id).toBe("1")
    expect(withClauseViaA).toBe(withClauseViaB)
    expect(withClauseViaA.attributes["Multi Parent"]).toBe("true")
    expect(withClauseViaA.attributes["Parent Operator Ids"]).toBe('["3","8"]')
    // Deduplicated node count: 0(scan),1(withclause),3(filter),8(filter),9(union) = 5
    expect(collect(root)).toHaveLength(5)
  })

  it("does not infinite-loop reconstructing a multi-parent DAG", () => {
    const start = Date.now()
    parseSnowflakeOperatorStats(loadFixture("multi-parent-with-clause.json"))
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it("promotes spill-to-remote/local-disk to an easily-checkable attribute and spill.occurred", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("spill-to-remote-disk.json"))
    expect(root.attributes["Spilled To Local Storage"]).toBe(104857600)
    expect(root.attributes["Spilled To Remote Storage"]).toBe(52428800)
    expect(root.spill?.occurred).toBe(true)
    expect(root.spill?.bytesLocal).toBe(104857600)
    expect(root.spill?.bytesRemote).toBe(52428800)
  })

  it("does not flag spill when none occurred", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("simple-table-scan.json"))
    expect(root.attributes["Spilled To Local Storage"]).toBeUndefined()
    expect(root.attributes["Spilled To Remote Storage"]).toBeUndefined()
    expect(root.spill).toBeUndefined()
  })

  it("promotes join.logicalType and predicate.filter/joinCondition from operator attributes", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("join-filter-aggregate.json"))
    const join = root.children[0]
    expect(join.rawOperatorLabel).toBe("Join")
    expect(join.join?.logicalType).toBe("inner")
    expect(join.predicate?.joinCondition).toBe("ORDERS.CUSTOMER_ID = CUSTOMERS.ID")

    const filter = join.children.find((c) => c.rawOperatorLabel === "Filter")!
    expect(filter.predicate?.filter).toBe("TOTAL > 100")
  })

  it("promotes io.bytesScanned from the nested io stats object", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("simple-table-scan.json"))
    expect(root.io?.bytesScanned).toBe(52428800)
  })

  it("promotes pruning.partitionsScanned/partitionsTotal for a high-partition-count TableScan", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("high-partition-count-scan.json"))
    expect(root.pruning?.partitionsScanned).toBe(84213)
    expect(root.pruning?.partitionsTotal).toBe(84213)
  })

  it("detects and cleanly labels redacted query text instead of treating it as literal content", () => {
    const { root, queryText, queryTextRedacted } = parseSnowflakeOperatorStats(
      loadFixture("redacted-query-text.json"),
    )
    expect(queryText).toBe("<redacted>")
    expect(queryTextRedacted).toBe(true)
    expect(root.attributes["Query Text"]).toBe("query text redacted by account policy")
    expect(root.attributes["Query Text Redacted"]).toBe("true")
    // Raw value still preserved untouched alongside the promoted, cleaned form.
    expect(root.attributes["attr.sql_text"]).toBe("<redacted>")
  })

  it("handles a very-high-partition-count TableScan without breaking numeric fields", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("high-partition-count-scan.json"))
    expect(root.actualRows).toBe(48213000000)
    expect(root.attributes["attr.partitions_total"]).toBe(84213)
  })

  it("tolerates a result-grid-style export with uppercase keys and stringified array/object columns", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("near-miss-grid-export.json"))
    expect(root.rawOperatorLabel).toBe("Filter")
    expect(root.children).toHaveLength(1)
    expect(root.children[0].rawOperatorLabel).toBe("TableScan")
    expect(root.children[0].attributes["attr.table_name"]).toBe("MY_DB.PUBLIC.ORDERS")
    expect(root.actualRows).toBe(480)
  })

  // Found via manual testing with a user-supplied export: a singular
  // `parentOperatorId` (one id, not Snowflake's own plural/array
  // `PARENT_OPERATORS` column) meant every row looked parentless, so the
  // parser silently produced 8 disconnected "root" nodes instead of the
  // real join tree — a much bigger problem than a missing glossary entry.
  it("tolerates a singular parentOperatorId field, reconstructing real parent-child links instead of treating every row as a root", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("singular-parent-flat-stats.json"))
    expect(root.rawOperatorLabel).toBe("Filter")
    expect(root.children).toHaveLength(1)
    expect(root.children[0].rawOperatorLabel).toBe("TableScan")
  })

  // Same fixture: this export has no separate `statistics`/
  // `operatorStatistics` container at all — `outputRows` sits as a plain
  // sibling field on the row. Without the row-level statistics fallback,
  // EVERY node's actualRows comes back undefined.
  it("tolerates row/time figures sitting as plain sibling fields instead of nested under a statistics container", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("singular-parent-flat-stats.json"))
    expect(root.actualRows).toBe(480)
    expect(root.children[0].actualRows).toBe(5000)
  })

  it("does NOT apply the row-level statistics fallback when a real statistics container is already present", () => {
    // A row with BOTH a real `statistics` object AND its own stray
    // top-level `outputRows` (malformed/inconsistent input) must trust the
    // real container, not merge the stray field in on top of it.
    const raw = JSON.stringify([
      { id: 1, operation: "Filter", parentOperators: [], statistics: { output_rows: 10 }, outputRows: 999 },
    ])
    const { root } = parseSnowflakeOperatorStats(raw)
    expect(root.actualRows).toBe(10)
  })

  it("falls back to 'unknown' operatorType for an unmapped operation, without throwing", () => {
    const raw = JSON.stringify([{ id: 1, operation: "SomeBrandNewOperator", parentOperators: [] }])
    const { root } = parseSnowflakeOperatorStats(raw)
    expect(root.operatorType).toBe("unknown")
    expect(root.rawOperatorLabel).toBe("SomeBrandNewOperator")
  })

  it("throws EMPTY_INPUT on empty/whitespace-only input", () => {
    try {
      parseSnowflakeOperatorStats("   \n  ")
      expect.unreachable()
    } catch (err) {
      expect((err as PlanParseError).code).toBe("EMPTY_INPUT")
    }
  })

  it("throws EMPTY_RESULT (distinct from EMPTY_INPUT) for a valid-but-empty operator list", () => {
    try {
      parseSnowflakeOperatorStats(loadFixture("empty-result.json"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("EMPTY_RESULT")
    }
  })

  it("throws NOT_A_PLAN for pasted non-plan text, pointing at the correct function, without echoing raw content", () => {
    try {
      parseSnowflakeOperatorStats(loadFixture("non-plan-text.txt"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("NOT_A_PLAN")
      expect(e.message).toContain("GET_QUERY_OPERATOR_STATS")
      expect(e.message).not.toContain("lifetime_value")
      expect(e.message).not.toContain("customer_id")
    }
  })

  it("throws NOT_A_PLAN for well-formed JSON that isn't operator-stats shaped", () => {
    try {
      parseSnowflakeOperatorStats('{"foo": "bar"}')
      expect.unreachable()
    } catch (err) {
      expect((err as PlanParseError).code).toBe("NOT_A_PLAN")
    }
  })
})
