// Episode SEO-03, Story 03.2: sql-server-execution-plan-analyzer.html
// ships a static, crawlable snapshot of SqlServerLandingPage's content —
// same rationale as postgresLandingSnapshot.test.ts's own header comment.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  EXAMPLE_FINDING_BODY,
  H1,
  HOW_TO_GENERATE_TSQL_COMMAND,
  PRIVACY_POINTS,
  SUPPORTED_INPUT_FORMATS,
  TRY_SAMPLE_CTA_HREF,
  WHAT_IT_DETECTS,
  WHAT_PLANREADER_ANALYZES,
} from "../sqlServerLandingContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const html = readFileSync(path.join(REPO_ROOT, "sql-server-execution-plan-analyzer.html"), "utf-8")
const normalized = html.replace(/\s+/g, " ")

function expectContains(text: string) {
  expect(normalized).toContain(text.replace(/\s+/g, " "))
}

describe("sql-server-execution-plan-analyzer.html's static snapshot", () => {
  it("has a non-empty .landing-page block in #root", () => {
    const match = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)
    expect(match).not.toBeNull()
    expect(match![1].trim().length).toBeGreaterThan(0)
  })

  it("has the real H1 and all 8 section headings, in the story's own order", () => {
    expectContains(`<h1>${H1}</h1>`)
    const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(headings).toEqual([
      "What PlanReader analyzes",
      "Supported input formats",
      "What it detects",
      "Example finding",
      "Privacy",
      "How to generate a Showplan XML",
      "Try a sample plan",
      "Deep learning resources",
    ])
  })

  it("contains the 'what PlanReader analyzes' and example-finding copy verbatim", () => {
    expectContains(WHAT_PLANREADER_ANALYZES)
    expectContains(EXAMPLE_FINDING_BODY)
  })

  it("names .sqlplan/Showplan XML, estimated plans, and multi-statement batches", () => {
    for (const format of SUPPORTED_INPUT_FORMATS) {
      expectContains(format.label)
    }
  })

  it("contains every privacy point and detected-issue label", () => {
    for (const item of PRIVACY_POINTS) {
      expectContains(item)
    }
    for (const issue of WHAT_IT_DETECTS) {
      expectContains(issue.label)
    }
  })

  it("contains the real STATISTICS XML command", () => {
    expectContains(HOW_TO_GENERATE_TSQL_COMMAND)
  })

  it("links to the real sample-plans anchor and mssqlserver.dev, not an invented URL", () => {
    expectContains(`href="${TRY_SAMPLE_CTA_HREF}"`)
    expectContains('href="https://mssqlserver.dev"')
  })

  it("has a canonical/OG URL matching the clean, no-.html production URL", () => {
    expect(html).toContain('<link rel="canonical" href="https://www.planreader.dev/sql-server-execution-plan-analyzer" />')
    expect(html).not.toMatch(/canonical" href="[^"]*\.html/)
  })

  it("has no aggregateRating/review/ratingValue property", () => {
    expect(html).not.toContain('"aggregateRating"')
    expect(html).not.toContain('"review"')
    expect(html).not.toContain('"ratingValue"')
  })
})
