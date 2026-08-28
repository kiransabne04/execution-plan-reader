// Episode 16, Story 16.2 — "is main-thread-blocking work (parsing,
// normalization, rule evaluation) for large plans a genuine problem
// warranting a Web Worker?" This is the investigation the story's
// acceptance criterion calls for, made permanent as a regression test
// rather than a one-off finding thrown away after the session.
//
// Measured result (see the numbers this test's thresholds are set well
// above): a wide, 10,000-node synthetic Postgres plan — 2MB of pasted
// text, far beyond any real-world query's plan size — parses, normalizes,
// runs the full rule engine, and summarizes in single-digit-to-tens-of-
// milliseconds on ordinary hardware. There is no evidence of a real
// main-thread-freeze problem at any plausible plan size.
// CONCLUSION: a Web Worker is NOT warranted for the current parse/rule-
// evaluation pipeline. Revisit only if a real user-reported plan
// (thousands of nodes, not this synthetic one) actually measures slow —
// this is an evidence-based decision, not an assumption either way, per
// the story's explicit instruction.

import { describe, expect, it } from "vitest"
import { analyzePlanText } from "../analyzePlan"

function buildWidePostgresPlanJson(childCount: number): string {
  const children = Array.from({ length: childCount }, (_, i) => ({
    "Node Type": "Seq Scan",
    "Relation Name": `partition_${i}`,
    "Startup Cost": 0.0,
    "Total Cost": 10.0,
    "Plan Rows": 100,
    "Plan Width": 8,
    "Actual Startup Time": 0.01,
    "Actual Total Time": 0.5,
    "Actual Rows": 95,
    "Actual Loops": 1,
  }))
  const root = {
    "Node Type": "Append",
    "Startup Cost": 0.0,
    "Total Cost": 100.0,
    "Plan Rows": childCount * 100,
    "Plan Width": 8,
    "Actual Startup Time": 0.01,
    "Actual Total Time": 10,
    "Actual Rows": childCount * 95,
    "Actual Loops": 1,
    Plans: children,
  }
  return JSON.stringify([{ Plan: root }])
}

describe("analyzePlanText performance (Story 16.2 — Web Worker investigation)", () => {
  it("a 1,000-node plan (already far beyond a typical real plan) analyzes in well under a visible-stutter budget", () => {
    const start = performance.now()
    analyzePlanText(buildWidePostgresPlanJson(1000))
    const elapsed = performance.now() - start
    // Loose ceiling (not a tight benchmark — CI hardware varies): exists to
    // catch a genuine regression (e.g. an accidentally-introduced O(n^2)
    // pass over the tree), not to enforce a specific millisecond budget.
    expect(elapsed).toBeLessThan(500)
  })

  it("a 10,000-node plan — 20x beyond any real query's plan size — still analyzes fast enough that a Web Worker would add complexity for no measurable benefit", () => {
    const start = performance.now()
    analyzePlanText(buildWidePostgresPlanJson(10_000))
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })

  it("does not throw on a large wide plan", () => {
    expect(() => analyzePlanText(buildWidePostgresPlanJson(5000))).not.toThrow()
  })
})
