// Episode SEO-03, Story 03.3 — the standalone Snowflake landing page.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { SnowflakeLandingPage } from "../SnowflakeLandingPage"
import { ALL_RULES } from "../../rules"
import { ANALYZER_CTA_HREF, TRY_SAMPLE_CTA_HREF, WHAT_IT_DETECTS } from "../snowflakeLandingContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

// Episode 35 (Snowflake Query Context) is held, architecturally-undecided
// scope this page must never imply already exists — see
// snowflakeLandingContent.ts's own header comment.
const OUT_OF_SCOPE_TERMS = ["Query Context", "QUERY_HISTORY", "warehouse queuing", "warehouse-queuing", "QAS", "query hash"]

describe("SnowflakeLandingPage — Story 03.3", () => {
  it("has exactly one H1 and the story's own H2 section order, with no Deep learning resources section", () => {
    render(<SnowflakeLandingPage />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
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

  it("Analyzer CTA and Try-sample CTA are plain links to the real app, not a second embedded analyzer", () => {
    render(<SnowflakeLandingPage />)
    expect(screen.getByTestId("analyzer-cta")).toHaveAttribute("href", ANALYZER_CTA_HREF)
    expect(screen.getByTestId("try-sample-cta")).toHaveAttribute("href", TRY_SAMPLE_CTA_HREF)
    expect(TRY_SAMPLE_CTA_HREF).toBe("/#sample-plans")
  })

  it("never mentions Query Context / QUERY_HISTORY / warehouse-queuing / QAS terminology (Episode 35 is held, separate scope)", () => {
    const { container } = render(<SnowflakeLandingPage />)
    const text = container.textContent ?? ""
    for (const term of OUT_OF_SCOPE_TERMS) {
      expect(text).not.toContain(term)
    }
  })

  it("every referenced rule id is a real string literal somewhere in src/rules/ (never invented capability)", () => {
    expect(ALL_RULES.length).toBeGreaterThan(0)
    const rulesDir = path.join(REPO_ROOT, "src/rules")
    const files = readdirSync(rulesDir).filter((f: string) => f.endsWith(".ts") && !f.includes("__tests__"))
    const allSource = files.map((f: string) => readFileSync(path.join(rulesDir, f), "utf-8")).join("\n")
    for (const issue of WHAT_IT_DETECTS) {
      expect(allSource).toContain(issue.ruleId)
    }
  })
})
