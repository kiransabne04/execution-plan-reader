// Episode SEO-03, Story 03.1 — the standalone PostgreSQL landing page.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { PostgresLandingPage } from "../PostgresLandingPage"
import { ALL_RULES } from "../../rules"
import {
  ANALYZER_CTA_HREF,
  SUPPORTED_INPUT_FORMATS,
  TRY_SAMPLE_CTA_HREF,
  WHAT_IT_DETECTS,
} from "../postgresLandingContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const rulesSource = ALL_RULES.length // sanity: registry actually imports/builds

describe("PostgresLandingPage — Story 03.1", () => {
  it("has exactly one H1 and the story's own H2 section order", () => {
    render(<PostgresLandingPage />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      "What PlanReader analyzes",
      "Supported input formats",
      "What it detects",
      "Example finding",
      "Privacy",
      "How to generate EXPLAIN input",
      "Try a sample plan",
      "Deep learning resources",
    ])
  })

  it("Analyzer CTA and Try-sample CTA are plain links to the real app, not a second embedded analyzer", () => {
    render(<PostgresLandingPage />)
    expect(screen.getByTestId("analyzer-cta")).toHaveAttribute("href", ANALYZER_CTA_HREF)
    expect(screen.getByTestId("try-sample-cta")).toHaveAttribute("href", TRY_SAMPLE_CTA_HREF)
    // The real, existing sample-plans anchor id (PasteBox.tsx / homepageContent.ts) — no new deep-link plumbing.
    expect(TRY_SAMPLE_CTA_HREF).toBe("/#sample-plans")
  })

  it("names both real accepted Postgres input formats", () => {
    render(<PostgresLandingPage />)
    for (const format of SUPPORTED_INPUT_FORMATS) {
      expect(screen.getByText(format.label)).toBeInTheDocument()
    }
  })

  it("links to kiransabne.dev instead of recreating the deep EXPLAIN guide", () => {
    render(<PostgresLandingPage />)
    expect(screen.getByRole("link", { name: "kiransabne.dev" })).toHaveAttribute("href", "https://kiransabne.dev")
  })

  it("every referenced rule id is a real string literal somewhere in src/rules/ (never invented capability)", () => {
    expect(rulesSource).toBeGreaterThan(0)
    const rulesDir = path.join(REPO_ROOT, "src/rules")
    const files = readdirSync(rulesDir).filter((f: string) => f.endsWith(".ts") && !f.includes("__tests__"))
    const allSource = files.map((f: string) => readFileSync(path.join(rulesDir, f), "utf-8")).join("\n")
    for (const issue of WHAT_IT_DETECTS) {
      expect(allSource).toContain(issue.ruleId)
    }
  })
})
