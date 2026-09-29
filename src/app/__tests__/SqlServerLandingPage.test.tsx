// Episode SEO-03, Story 03.2 — the standalone SQL Server landing page.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { SqlServerLandingPage } from "../SqlServerLandingPage"
import { ALL_RULES } from "../../rules"
import {
  ANALYZER_CTA_HREF,
  SUPPORTED_INPUT_FORMATS,
  TRY_SAMPLE_CTA_HREF,
  WHAT_IT_DETECTS,
} from "../sqlServerLandingContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

describe("SqlServerLandingPage — Story 03.2", () => {
  it("has exactly one H1 and the story's own H2 section order", () => {
    render(<SqlServerLandingPage />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
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

  it("Analyzer CTA and Try-sample CTA are plain links to the real app, not a second embedded analyzer", () => {
    render(<SqlServerLandingPage />)
    expect(screen.getByTestId("analyzer-cta")).toHaveAttribute("href", ANALYZER_CTA_HREF)
    expect(screen.getByTestId("try-sample-cta")).toHaveAttribute("href", TRY_SAMPLE_CTA_HREF)
    expect(TRY_SAMPLE_CTA_HREF).toBe("/#sample-plans")
  })

  it("names .sqlplan/Showplan XML, estimated plans, and multi-statement batches", () => {
    render(<SqlServerLandingPage />)
    for (const format of SUPPORTED_INPUT_FORMATS) {
      expect(screen.getByText(format.label)).toBeInTheDocument()
    }
  })

  it("links to mssqlserver.dev instead of recreating deep technical content", () => {
    render(<SqlServerLandingPage />)
    expect(screen.getByRole("link", { name: "mssqlserver.dev" })).toHaveAttribute("href", "https://mssqlserver.dev")
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

  it("names multi-statement batches as a real capability (BatchStatementOverview.tsx exists)", () => {
    const exists = readdirSync(path.join(REPO_ROOT, "src/app")).includes("BatchStatementOverview.tsx")
    expect(exists).toBe(true)
  })
})
