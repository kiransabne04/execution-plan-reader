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
})
