// User-requested: every MVP + Episode 21 rule, driven through the REAL
// parse -> rule-engine pipeline against a real Postgres EXPLAIN (FORMAT
// JSON) fixture built specifically to cross that rule's own threshold —
// not just the rule function in isolation via makeNode (already covered,
// exhaustively, by each rule's own *.test.ts). This is the integration-
// level proof that the parser actually WIRES UP the field the rule reads,
// which a hand-built PlanNode can't catch (a parser field-name typo would
// leave every unit test green while the real pipeline silently never
// populates the field at all).

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { analyzePlanText } from "../analyzePlan"
import { collectNodes } from "../../parsers/normalize"

function loadFixture(filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/postgres")
  return readFileSync(path.join(dir, filename), "utf-8")
}

function allRuleIds(text: string): string[] {
  const result = analyzePlanText(text)
  return collectNodes(result.statements[0].root).flatMap((n) => n.warnings.map((w) => w.ruleId))
}

describe("Postgres rule-trigger scenarios — end-to-end (user-requested)", () => {
  it("bad-row-estimate fires on a 50x estimate-vs-actual mismatch", () => {
    const ids = allRuleIds(loadFixture("rule-bad-row-estimate.json"))
    expect(ids).toContain("bad-row-estimate")
  })

  it("seq-scan-on-large-table fires on a full scan of 50,000 rows", () => {
    const ids = allRuleIds(loadFixture("rule-seq-scan-large-table.json"))
    expect(ids).toContain("seq-scan-on-large-table")
    // And does NOT also fire bad-row-estimate — estimate matched actual here.
    expect(ids).not.toContain("bad-row-estimate")
  })

  it("disk-spill fires on a Sort with Sort Space Type: Disk (external merge)", () => {
    const ids = allRuleIds(loadFixture("rule-disk-spill-sort.json"))
    expect(ids).toContain("disk-spill")
  })

  it("disk-spill fires on a Hash node reporting Disk Usage (hash spill)", () => {
    const ids = allRuleIds(loadFixture("rule-disk-spill-hash.json"))
    expect(ids).toContain("disk-spill")
  })

  it("high-loop-count fires on 2,000 loops at 2.1ms each", () => {
    const ids = allRuleIds(loadFixture("rule-high-loop-count.json"))
    expect(ids).toContain("high-loop-count")
  })

  it("exploding-join fires when a Nested Loop's output is 500x its largest input", () => {
    const ids = allRuleIds(loadFixture("rule-exploding-join.json"))
    expect(ids).toContain("exploding-join")
  })

  it("non-sargable-predicate fires on a function-wrapped column (lower(email) = ...)", () => {
    const ids = allRuleIds(loadFixture("rule-non-sargable-function-wrapped.json"))
    expect(ids).toContain("non-sargable-predicate")
  })

  it("non-sargable-predicate fires on Postgres's own leading-wildcard LIKE rendering (~~ '%...')", () => {
    const ids = allRuleIds(loadFixture("rule-non-sargable-leading-wildcard.json"))
    expect(ids).toContain("non-sargable-predicate")
  })

  it("parameter-sensitivity-honesty-note fires on a $1-style Postgres parameter placeholder", () => {
    const ids = allRuleIds(loadFixture("rule-parameter-sensitivity.json"))
    expect(ids).toContain("parameter-sensitivity-honesty-note")
  })

  it("buffer-cache-inefficiency fires on a genuinely low BUFFERS hit ratio (reusing the Episode 21 fixture)", () => {
    const ids = allRuleIds(loadFixture("low-buffer-cache-hit-ratio.json"))
    expect(ids).toContain("buffer-cache-inefficiency")
  })

  it("estimate-only-plan fires when no ANALYZE data is present at all (reusing the existing fixture)", () => {
    const ids = allRuleIds(loadFixture("estimate-only-plan.json"))
    expect(ids).toContain("estimate-only-plan")
  })

  // Negative control: a plan with none of the above trigger conditions
  // must produce zero findings, not a false positive from an
  // over-eager threshold. Reuses the existing clean fixture.
  it("a clean plan with no trigger conditions produces zero findings", () => {
    const ids = allRuleIds(loadFixture("simple-seq-scan.json"))
    expect(ids).toEqual([])
  })

  // Episode 24 — Postgres advanced rules, each through the real parser ->
  // rule-engine pipeline against a real fixture, per Story 24.13's own
  // explicit requirement.
  it("index-only-heap-fetches fires on a 90% heap-fetch ratio", () => {
    const ids = allRuleIds(loadFixture("rule-index-only-heap-fetches.json"))
    expect(ids).toContain("index-only-heap-fetches")
  })

  it("filter-rows-discarded fires on 9M removed vs. 100 returned", () => {
    const ids = allRuleIds(loadFixture("rule-filter-rows-discarded.json"))
    expect(ids).toContain("filter-rows-discarded")
  })

  it("join-filter-rows-discarded fires on 19.95M candidate combinations discarded", () => {
    const ids = allRuleIds(loadFixture("rule-join-filter-rows-discarded.json"))
    expect(ids).toContain("join-filter-rows-discarded")
  })

  it("hash-batching fires on Hash Batches: 4 (reusing the existing disk-spill-hash fixture — both findings legitimately co-occur)", () => {
    const ids = allRuleIds(loadFixture("rule-disk-spill-hash.json"))
    expect(ids).toContain("hash-batching")
    expect(ids).toContain("disk-spill") // the generic signal still fires too — this rule is additive, not a replacement
  })

  it("sort-large fires on a 100MB+ external merge (reusing the existing disk-spill-sort fixture)", () => {
    const ids = allRuleIds(loadFixture("rule-disk-spill-sort.json"))
    expect(ids).toContain("sort-large")
    expect(ids).toContain("disk-spill")
  })

  it("temp-io fires on material Temp Read/Written Blocks, and relates itself to the co-occurring disk-based sort", () => {
    const { statements } = analyzePlanText(loadFixture("rule-temp-io.json"))
    const findings = collectNodes(statements[0].root).flatMap((n) => n.warnings)
    const tempIoFinding = findings.find((w) => w.ruleId === "temp-io")
    expect(tempIoFinding).toBeDefined()
    expect(tempIoFinding!.longText).toMatch(/matches the disk-based sort/i)
  })

  it("planning-overhead fires when planning (240ms) dominates execution (8ms)", () => {
    const ids = allRuleIds(loadFixture("rule-planning-overhead.json"))
    expect(ids).toContain("planning-overhead")
  })

  it("jit-overhead fires when JIT (28ms) is a large share of execution (40ms)", () => {
    const ids = allRuleIds(loadFixture("rule-jit-overhead.json"))
    expect(ids).toContain("jit-overhead")
  })

  it("materialize-repeated fires on a large, frequently re-scanned Materialize", () => {
    const ids = allRuleIds(loadFixture("rule-materialize-repeated.json"))
    expect(ids).toContain("materialize-repeated")
  })

  it("memoize-low-hit-rate fires on a 10% Memoize hit rate", () => {
    const ids = allRuleIds(loadFixture("rule-memoize-low-hit-rate.json"))
    expect(ids).toContain("memoize-low-hit-rate")
  })

  it("partition-fanout fires on a 50-child Append with no pruning evidence captured", () => {
    const ids = allRuleIds(loadFixture("rule-partition-fanout.json"))
    expect(ids).toContain("partition-fanout")
  })

  it("wal-volume fires on a materially large WAL-generating Insert", () => {
    const ids = allRuleIds(loadFixture("rule-wal-volume.json"))
    expect(ids).toContain("wal-volume")
  })

  // Negative controls for the Episode 24 rules specifically — the SAME
  // "healthy" fixture already used above must not accidentally trip any
  // of the 12 new rules either, now that they're all registered.
  it("the existing clean fixture still produces zero findings with all 12 new rules registered", () => {
    const ids = allRuleIds(loadFixture("simple-seq-scan.json"))
    expect(ids).toEqual([])
  })
})
