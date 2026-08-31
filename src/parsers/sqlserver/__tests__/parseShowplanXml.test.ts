import { describe, expect, it } from "vitest"
import { parseSqlServerShowplanXml } from "../parseShowplanXml"
import { PlanParseError, collectNodes } from "../../normalize"
import { loadFixture } from "./testUtils"

const collect = collectNodes

describe("parseSqlServerShowplanXml", () => {
  it("parses a simple scan and maps standard RelOp fields", () => {
    const result = parseSqlServerShowplanXml(loadFixture("default-namespace-scan.xml"))
    expect(result.statements).toHaveLength(1)
    const [stmt] = result.statements
    expect(stmt.statementText).toBe("SELECT * FROM Orders")
    expect(stmt.statementId).toBe("1")
    const root = stmt.root
    expect(root.engine).toBe("sqlserver")
    expect(root.rawOperatorLabel).toBe("Table Scan")
    expect(root.operatorType).toBe("seq_scan")
    expect(root.estimatedRows).toBe(100)
    expect(root.estimatedCost).toBe(0.5)
    expect(root.actualRows).toBe(98)
    expect(root.loops).toBe(1)
    expect(root.actualTimeMs).toBe(12)
    expect(root.attributes["Object.Table"]).toBe("[Orders]")
    expect(root.attributes["Object.Database"]).toBe("[MyDb]")
  })

  it("parses identically regardless of default vs prefixed namespace declaration", () => {
    const viaDefault = parseSqlServerShowplanXml(loadFixture("default-namespace-scan.xml"))
    const viaPrefixed = parseSqlServerShowplanXml(loadFixture("prefixed-namespace-scan.xml"))
    expect(viaPrefixed.statements[0].root.rawOperatorLabel).toBe(
      viaDefault.statements[0].root.rawOperatorLabel,
    )
    expect(viaPrefixed.statements[0].root.operatorType).toBe(viaDefault.statements[0].root.operatorType)
    expect(viaPrefixed.statements[0].root.actualRows).toBe(viaDefault.statements[0].root.actualRows)
  })

  it("finds ShowPlanXML wrapped inside Extended Events XML, not at the document root", () => {
    const result = parseSqlServerShowplanXml(loadFixture("extended-events-wrapped.xml"))
    expect(result.statements).toHaveLength(1)
    expect(result.statements[0].root.rawOperatorLabel).toBe("Table Scan")
  })

  it("reconstructs a Nested Loops join with Index Seek + Key Lookup children", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const root = result.statements[0].root
    expect(root.rawOperatorLabel).toBe("Nested Loops")
    expect(root.operatorType).toBe("nested_loop_join")
    expect(root.children).toHaveLength(2)
    expect(root.children[0].operatorType).toBe("index_seek")
    expect(root.children[1].operatorType).toBe("key_lookup")
    expect(root.children[1].loops).toBe(5) // ActualExecutions
  })

  it("normalizes join.logicalType from LogicalOp text", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    expect(result.statements[0].root.join?.logicalType).toBe("left_outer")
  })

  it("promotes index.type from the Object element's IndexKind attribute", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const root = result.statements[0].root
    expect(root.children[0].index?.type).toBe("nonclustered")
    expect(root.children[0].index?.name).toBe("[IX_Orders_CustomerId]")
    expect(root.children[1].index?.type).toBe("clustered")
    expect(root.children[1].index?.name).toBe("[PK_Orders]")
    // The join itself (Nested Loops) has no Object of its own — confirms
    // findNearestDescendant doesn't cross into a child RelOp's subtree and
    // leak one child's index onto the parent (docs/11-manual-testing-gaps-
    // episode8.md's open index-name item).
    expect(root.index).toBeUndefined()
  })

  // Same open item, harder case: a DML operator (Update/Insert/Delete/Merge)
  // nests its own Object as a SIBLING of a child RelOp under one wrapper
  // element, rather than Object being the child RelOp's only detail content
  // (as in the Index Seek/Key Lookup fixture above). This is the shape most
  // likely to leak one node's index onto the other if the RelOp boundary
  // check were ever off by one level.
  it("attributes each of an Update's own index and its source seek's index correctly, without cross-contamination", () => {
    const result = parseSqlServerShowplanXml(loadFixture("update-with-source-seek.xml"))
    const root = result.statements[0].root
    expect(root.rawOperatorLabel).toBe("Clustered Index Update")
    expect(root.index?.name).toBe("[PK_Orders]")
    expect(root.index?.type).toBe("clustered")

    expect(root.children).toHaveLength(1)
    const seek = root.children[0]
    expect(seek.rawOperatorLabel).toBe("Index Seek")
    expect(seek.index?.name).toBe("[IX_Orders_CustomerId]")
    expect(seek.index?.type).toBe("nonclustered")
  })

  it("extracts predicate.indexCondition from SeekPredicates and predicate.filter from Predicate", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const root = result.statements[0].root
    expect(root.children[0].predicate?.indexCondition).toContain("CustomerId]=(42)")
    expect(root.children[1].predicate?.filter).toContain("Status]='active'")
  })

  // Real bug found manually verifying seek-predicate capture: SeekPredicates
  // emits one ScalarOperator PER seek column, unlike Predicate/Filter's one
  // pre-combined string — the naive "first ScalarString found" approach
  // silently dropped every column after the first on a composite seek.
  it("captures every column of a composite (multi-column) index seek, not just the first", () => {
    const result = parseSqlServerShowplanXml(loadFixture("composite-index-seek.xml"))
    const condition = result.statements[0].root.predicate?.indexCondition
    expect(condition).toContain("CustomerId]=(42)")
    expect(condition).toContain("OrderDate]=('2024-01-01')")
  })

  it("promotes io.bufferHits/bufferReads (derived from logical/physical reads) with an approximate cacheHitRatio", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const seek = result.statements[0].root.children[0]
    expect(seek.io?.bufferReads).toBe(2)
    expect(seek.io?.bufferHits).toBe(10) // 12 logical - 2 physical
    expect(seek.io?.cacheHitRatio).toBeCloseTo(10 / 12)
  })

  it("promotes ActualReadAheads to io.readAheads, separate from bufferReads", () => {
    const result = parseSqlServerShowplanXml(loadFixture("read-ahead-heavy-scan.xml"))
    const root = result.statements[0].root
    expect(root.io?.bufferReads).toBe(500_000) // ActualPhysicalReads, unchanged — read-ahead is a SEPARATE field
    expect(root.io?.readAheads).toBe(499_500)
  })

  it("leaves io.readAheads undefined (not 0) when RunTimeInformation has no ActualReadAheads attribute at all", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const seek = result.statements[0].root.children[0]
    expect(seek.io?.readAheads).toBeUndefined()
  })

  it("derives rowsRemovedByFilter from ActualRowsRead vs ActualRows", () => {
    const result = parseSqlServerShowplanXml(loadFixture("seek-and-key-lookup.xml"))
    const keyLookup = result.statements[0].root.children[1]
    expect(keyLookup.rowsRemovedByFilter).toBe(3) // 8 read - 5 returned
  })

  it("disambiguates Hash Match into hash_join via LogicalOp", () => {
    const result = parseSqlServerShowplanXml(loadFixture("hash-join.xml"))
    const root = result.statements[0].root
    expect(root.rawOperatorLabel).toBe("Hash Match")
    expect(root.operatorType).toBe("hash_join")
    expect(root.children).toHaveLength(2)
    expect(root.children.map((c) => c.attributes["Object.Table"])).toEqual(["[Orders]", "[Customers]"])
  })

  it("reconstructs Merge Join over a Sort", () => {
    const result = parseSqlServerShowplanXml(loadFixture("merge-join-and-sort.xml"))
    const root = result.statements[0].root
    expect(root.operatorType).toBe("merge_join")
    expect(root.children[0].operatorType).toBe("sort")
    expect(root.children[0].children[0].operatorType).toBe("seq_scan")
    expect(root.children[1].operatorType).toBe("index_scan")
  })

  it("aggregates per-thread parallel data and labels it as cumulated across threads", () => {
    const result = parseSqlServerShowplanXml(loadFixture("parallelism-multi-thread.xml"))
    const root = result.statements[0].root
    expect(root.operatorType).toBe("gather")
    const scan = root.children[0]
    expect(scan.attributes["Threads"]).toBe(3)
    expect(scan.attributes["Actual Time Is Cumulated Across Threads"]).toBe("true")
    expect(scan.actualRows).toBe(6667 + 6667 + 6666)
    expect(scan.actualTimeMs).toBe(38 + 41 + 39)
  })

  it("promotes parallel.workersLaunched and derives an approximate per-execution time from the thread count", () => {
    const result = parseSqlServerShowplanXml(loadFixture("parallelism-multi-thread.xml"))
    const scan = result.statements[0].root.children[0]
    expect(scan.parallel?.workersLaunched).toBe(3)
    const totalMs = 38 + 41 + 39
    expect(scan.actualTimePerExecutionMs).toBeCloseTo(totalMs / 3)
  })

  it("sets actualTimePerExecutionMs equal to actualTimeMs when there's no parallelism or looping", () => {
    const result = parseSqlServerShowplanXml(loadFixture("default-namespace-scan.xml"))
    const root = result.statements[0].root
    expect(root.actualTimePerExecutionMs).toBe(root.actualTimeMs)
  })

  it("does not crash when RunTimeInformation is entirely absent (estimated plan)", () => {
    const result = parseSqlServerShowplanXml(loadFixture("estimated-plan-only.xml"))
    const root = result.statements[0].root
    expect(root.actualRows).toBeUndefined()
    expect(root.actualTimeMs).toBeUndefined()
    expect(root.loops).toBeUndefined()
    expect(root.estimatedRows).toBe(100)
  })

  // Gaps 2/3 from docs/11-manual-testing-gaps-episode8.md: reproduces the
  // actual plan XML from manual testing (a 16-way-parallel, 16-node-deep
  // estimated plan) rather than guessing at a fix. Confirms both "gaps" were
  // data-source limitations, not parser or UI bugs — see that doc's
  // resolution notes for gaps 2 and 3.
  it("passes a genuinely large/deep parallel plan's every node through with no actual-run fields, and its already-truncated statement text unmodified (Gaps 2 & 3 repro)", () => {
    const result = parseSqlServerShowplanXml(loadFixture("real-world-large-parallel-estimated.xml"))
    const [stmt] = result.statements

    // Gap 2: the source XML's own StatementText attribute already ends in
    // "..." — the parser must not alter it further (no extra truncation,
    // no crash on the ellipsis), confirming the missing text was never in
    // the pasted data to begin with, not a client-side bug.
    expect(stmt.statementText).toBe("SELECT ENTERPRISE_MASSIVE_ANALYTICS...")

    // Gap 3: this plan has no RunTimeInformation anywhere in the XML (an
    // estimated, never-executed plan) despite being real, large, and
    // parallel — every single node's actual-run fields must be correctly
    // absent, not just the root's, confirming the gap-row behavior holds at
    // realistic scale/shape, not just on a single-node toy fixture.
    const allNodes = collect(stmt.root)
    expect(allNodes.length).toBeGreaterThan(10)
    for (const node of allNodes) {
      expect(node.actualRows).toBeUndefined()
      expect(node.actualTimeMs).toBeUndefined()
      expect(node.loops).toBeUndefined()
    }
  })

  it("detects multiple statements in one batch and surfaces both, not just the first", () => {
    const result = parseSqlServerShowplanXml(loadFixture("multi-statement-batch.xml"))
    expect(result.statements).toHaveLength(2)
    expect(result.statements[0].statementText).toBe("SELECT * FROM Orders")
    expect(result.statements[1].statementText).toBe("SELECT * FROM Customers")
    expect(result.statements[1].root.rawOperatorLabel).toBe("Clustered Index Scan")
  })

  it("promotes a tempdb spill (Warnings/SpillToTempDb) to an easily-checkable attribute and spill.occurred", () => {
    const result = parseSqlServerShowplanXml(loadFixture("sort-spill-to-tempdb.xml"))
    const root = result.statements[0].root
    expect(root.operatorType).toBe("sort")
    expect(root.attributes["Spill Occurred"]).toBe("true")
    expect(root.attributes["Spill Level"]).toBe(1)
    expect(root.spill?.occurred).toBe(true)
    expect(root.spill?.detail).toBe("spill level 1")
  })

  it("does not flag a spill when none occurred", () => {
    const result = parseSqlServerShowplanXml(loadFixture("default-namespace-scan.xml"))
    expect(result.statements[0].root.attributes["Spill Occurred"]).toBeUndefined()
    expect(result.statements[0].root.spill).toBeUndefined()
  })

  it("surfaces missing-index recommendations as a distinct, structured section", () => {
    const result = parseSqlServerShowplanXml(loadFixture("missing-index-recommendation.xml"))
    const [stmt] = result.statements
    expect(stmt.missingIndexes).toHaveLength(1)
    const [rec] = stmt.missingIndexes
    expect(rec.impact).toBe(99.5)
    expect(rec.table).toBe("[Orders]")
    expect(rec.equalityColumns).toEqual(["[CustomerId]"])
    expect(rec.includedColumns).toEqual(["[Total]"])
  })

  it("falls back to 'unknown' operatorType for an unmapped PhysicalOp, without throwing", () => {
    const xml = `<?xml version="1.0"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence><Batch><Statements>
    <StmtSimple StatementText="X" StatementId="1">
      <QueryPlan>
        <RelOp NodeId="0" PhysicalOp="Something Brand New" EstimateRows="1" EstimatedTotalSubtreeCost="1" />
      </QueryPlan>
    </StmtSimple>
  </Statements></Batch></BatchSequence>
</ShowPlanXML>`
    const result = parseSqlServerShowplanXml(xml)
    expect(result.statements[0].root.operatorType).toBe("unknown")
    expect(result.statements[0].root.rawOperatorLabel).toBe("Something Brand New")
  })

  it("throws EMPTY_INPUT on empty/whitespace-only input", () => {
    try {
      parseSqlServerShowplanXml("   \n  ")
      expect.unreachable()
    } catch (err) {
      expect((err as PlanParseError).code).toBe("EMPTY_INPUT")
    }
  })

  it("throws TRUNCATED_INPUT for a paste cut off mid-tag, without echoing raw content", () => {
    try {
      parseSqlServerShowplanXml(loadFixture("truncated-plan.xml"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("TRUNCATED_INPUT")
      expect(e.message).not.toContain("Table Scan")
    }
  })

  it("throws INVALID_XML for malformed/mismatched-tag XML, without echoing raw content", () => {
    try {
      parseSqlServerShowplanXml(loadFixture("malformed-mismatched-tags.xml"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      const e = err as PlanParseError
      expect(e.code).toBe("INVALID_XML")
      expect(e.message).not.toContain("Table Scan")
    }
  })

  it("throws NOT_A_PLAN for well-formed XML that isn't a Showplan document", () => {
    try {
      parseSqlServerShowplanXml(loadFixture("non-plan-xml.xml"))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PlanParseError)
      expect((err as PlanParseError).code).toBe("NOT_A_PLAN")
    }
  })

  it("gives every node in every fixture a stable id and non-empty children array", () => {
    for (const fixture of [
      "default-namespace-scan.xml",
      "seek-and-key-lookup.xml",
      "hash-join.xml",
      "merge-join-and-sort.xml",
      "parallelism-multi-thread.xml",
    ]) {
      const result = parseSqlServerShowplanXml(loadFixture(fixture))
      for (const node of collect(result.statements[0].root)) {
        expect(node.id).toBeTruthy()
        expect(Array.isArray(node.children)).toBe(true)
        expect(node.warnings).toEqual([])
      }
    }
  })
})
