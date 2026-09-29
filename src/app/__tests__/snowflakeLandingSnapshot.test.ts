// Episode SEO-03, Story 03.3: snowflake-query-profile-analyzer.html ships
// a static, crawlable snapshot of SnowflakeLandingPage's content — same
// rationale as postgresLandingSnapshot.test.ts's own header comment.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  EXAMPLE_FINDING_BODY,
  H1,
  HOW_TO_GENERATE_COMMAND,
  PRIVACY_POINTS,
  SUPPORTED_INPUT_FORMATS,
  TRY_SAMPLE_CTA_HREF,
  WHAT_IT_DETECTS,
  WHAT_PLANREADER_ANALYZES,
} from "../snowflakeLandingContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const html = readFileSync(path.join(REPO_ROOT, "snowflake-query-profile-analyzer.html"), "utf-8")
const normalized = html.replace(/\s+/g, " ")

function expectContains(text: string) {
  expect(normalized).toContain(text.replace(/\s+/g, " "))
}

const OUT_OF_SCOPE_TERMS = ["Query Context", "QUERY_HISTORY", "warehouse queuing", "warehouse-queuing", "QAS", "query hash"]

describe("snowflake-query-profile-analyzer.html's static snapshot", () => {
  it("has a non-empty .landing-page block in #root", () => {
    const match = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)
    expect(match).not.toBeNull()
    expect(match![1].trim().length).toBeGreaterThan(0)
  })

  it("has the real H1 and all 7 section headings, in the story's own order, no Deep learning resources section", () => {
    expectContains(`<h1>${H1}</h1>`)
    const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(headings).toEqual([
      "What PlanReader analyzes",
      "Supported input formats",
      "What it detects",
      "Example finding",
      "Privacy",
      "How to get this output",
      "Try a sample plan",
    ])
  })

  it("contains the 'what PlanReader analyzes' and example-finding copy verbatim", () => {
    expectContains(WHAT_PLANREADER_ANALYZES)
    expectContains(EXAMPLE_FINDING_BODY)
  })

  it("names both real input formats", () => {
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

  it("contains the real GET_QUERY_OPERATOR_STATS command (HTML-escaped)", () => {
    const escaped = HOW_TO_GENERATE_COMMAND.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    expectContains(escaped)
  })

  it("links to the real sample-plans anchor, not an invented URL", () => {
    expectContains(`href="${TRY_SAMPLE_CTA_HREF}"`)
  })

  it("has a canonical/OG URL matching the clean, no-.html production URL", () => {
    expect(html).toContain('<link rel="canonical" href="https://www.planreader.dev/snowflake-query-profile-analyzer" />')
    expect(html).not.toMatch(/canonical" href="[^"]*\.html/)
  })

  it("has no aggregateRating/review/ratingValue property", () => {
    expect(html).not.toContain('"aggregateRating"')
    expect(html).not.toContain('"review"')
    expect(html).not.toContain('"ratingValue"')
  })

  it("never mentions Query Context / QUERY_HISTORY / warehouse-queuing / QAS terminology in the page's own content (Episode 35 is held, separate scope)", () => {
    // Checked against the rendered #root content only, not this file's own
    // dev-comment header (which legitimately names these terms to explain
    // why they're absent) — same region the other content checks above use.
    const match = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)
    const rootContent = match![1]
    for (const term of OUT_OF_SCOPE_TERMS) {
      expect(rootContent).not.toContain(term)
    }
  })
})
