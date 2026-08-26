import { describe, expect, it } from "vitest"
import { parseSqlServerShowplanXml } from "../parseShowplanXml"
import { PlanParseError, type PlanNode } from "../../normalize"
import { loadFixture } from "./testUtils"

function collect(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node)
  node.children.forEach((c) => collect(c, out))
  return out
}

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

  it("does not crash when RunTimeInformation is entirely absent (estimated plan)", () => {
    const result = parseSqlServerShowplanXml(loadFixture("estimated-plan-only.xml"))
    const root = result.statements[0].root
    expect(root.actualRows).toBeUndefined()
    expect(root.actualTimeMs).toBeUndefined()
    expect(root.loops).toBeUndefined()
    expect(root.estimatedRows).toBe(100)
  })

  it("detects multiple statements in one batch and surfaces both, not just the first", () => {
    const result = parseSqlServerShowplanXml(loadFixture("multi-statement-batch.xml"))
    expect(result.statements).toHaveLength(2)
    expect(result.statements[0].statementText).toBe("SELECT * FROM Orders")
    expect(result.statements[1].statementText).toBe("SELECT * FROM Customers")
    expect(result.statements[1].root.rawOperatorLabel).toBe("Clustered Index Scan")
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
