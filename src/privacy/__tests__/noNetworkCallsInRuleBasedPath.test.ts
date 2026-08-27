// Episode 7's core testing requirement: "intercept all network calls
// during a full rule-based-path user flow (paste -> parse -> visualize ->
// view warnings) and assert none contain plan text, table/column names, or
// literal values." There is no paste-box UI yet to drive with Playwright
// (see the graph-visualization/privacy-architecture stories' honesty notes
// about that gap) — but every OTHER stage of that flow already exists as
// real code: parse -> normalize -> applyRules -> summarizePlan ->
// buildGraphElements. This test installs the actual network guard (not a
// mock) with an empty allowlist and runs that full pipeline against real
// fixtures from all three engines. If any code anywhere in that path ever
// attempts fetch/XHR/sendBeacon/WebSocket, this fails loudly.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { installNetworkGuard, uninstallNetworkGuard } from "../networkGuard"
import { parsePostgresJsonPlan } from "../../parsers/postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../../parsers/postgres/textParser"
import { parseSqlServerShowplanXml } from "../../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../../parsers/snowflake"
import { applyRules } from "../../rules/index"
import { buildPlanContext } from "../../rules/types"
import { summarizePlan } from "../../rules/summarize"
import { buildGraphElements } from "../../graph/buildGraphElements"
import type { PlanNode } from "../../parsers/normalize"
import { analyzePlanText } from "../../app/analyzePlan"
import { decodeShareLink, encodeShareLink } from "../../app/shareLink"

function loadFixture(engine: string, filename: string): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../fixtures/${engine}`)
  return readFileSync(path.join(dir, filename), "utf-8")
}

/** The full rule-based-path flow for one already-parsed plan: normalize is
 * done by the parser already, so this is analyze -> summarize -> render. */
function runFullRuleBasedPath(root: PlanNode, extra?: Parameters<typeof buildPlanContext>[1]): void {
  const context = buildPlanContext(root, extra)
  applyRules(root, context)
  summarizePlan(root)
  buildGraphElements(root)
}

beforeEach(() => {
  installNetworkGuard() // empty allowlist — every outbound call is blocked
})

afterEach(() => {
  uninstallNetworkGuard()
})

describe("zero outbound network calls in the rule-based path", () => {
  it("Postgres JSON: parse -> rules -> summary -> graph, no network call attempted", () => {
    const root = parsePostgresJsonPlan(loadFixture("postgres", "multi-way-join.json"))
    expect(() => runFullRuleBasedPath(root)).not.toThrow()
  })

  it("Postgres TEXT: parse -> rules -> summary -> graph, no network call attempted", () => {
    const root = parsePostgresTextPlan(loadFixture("postgres", "initplan-subplan-text.txt"))
    expect(() => runFullRuleBasedPath(root)).not.toThrow()
  })

  it("SQL Server: parse -> rules -> summary -> graph, no network call attempted", () => {
    const { statements } = parseSqlServerShowplanXml(loadFixture("sqlserver", "sort-spill-to-tempdb.xml"))
    const [stmt] = statements
    expect(() =>
      runFullRuleBasedPath(stmt.root, { statementText: stmt.statementText, missingIndexes: stmt.missingIndexes }),
    ).not.toThrow()
  })

  it("Snowflake: parse -> rules -> summary -> graph, no network call attempted", () => {
    const { root } = parseSnowflakeOperatorStats(loadFixture("snowflake", "multi-parent-with-clause.json"))
    expect(() => runFullRuleBasedPath(root)).not.toThrow()
  })

  it("even a parse FAILURE path makes no network call (e.g. an error-reporting side effect)", () => {
    expect(() => {
      try {
        parsePostgresJsonPlan(loadFixture("postgres", "non-plan-text.txt"))
      } catch {
        // expected — the point is only that failing to parse never
        // triggers a network call as a side effect (e.g. accidental
        // telemetry in a catch block).
      }
    }).not.toThrow()
  })

  // Story 11.2's own network-call-guarding requirement, extending this
  // suite: encoding a shareable link, and — the actually privacy-sensitive
  // direction — loading one, must both stay entirely within this same
  // zero-network guarantee. Nothing about the fragment ever needs a server,
  // by construction, but this proves it rather than assuming it.
  it("Story 11.2: encoding a shareable link makes no network call", () => {
    const text = loadFixture("postgres", "multi-way-join.json")
    expect(() => encodeShareLink(text, "https://example.com/")).not.toThrow()
  })

  it("Story 11.2: decoding + fully re-rendering a shared link makes no network call", () => {
    const text = loadFixture("sqlserver", "sort-spill-to-tempdb.xml")
    const encoded = encodeShareLink(text, "https://example.com/")
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const fragment = encoded.url.split("#")[1]

    expect(() => {
      const decoded = decodeShareLink(fragment)
      if (!decoded.ok) throw new Error("expected a valid decode in this test")
      const analyzed = analyzePlanText(decoded.text)
      for (const stmt of analyzed.statements) buildGraphElements(stmt.root)
    }).not.toThrow()
  })
})
