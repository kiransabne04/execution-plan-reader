import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test("analyzes a pasted Postgres plan and renders the summary + graph", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Postgres")
  await expect(page.getByTestId("plan-summary")).toBeVisible()
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
  await expect(page.getByTestId("parse-error")).toHaveCount(0)
})

test("shows a friendly error, not a crash, for pasted non-plan text", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "non-plan-text.txt"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("parse-error")).toBeVisible()
  await expect(page.getByTestId("plan-result")).toHaveCount(0)
})

test("surfaces every statement in a multi-statement SQL Server batch and switches between them", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "multi-statement-batch.xml"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  const tabs = page.getByRole("tab")
  await expect(tabs).toHaveCount(2)
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true")

  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(tabs.first()).toHaveAttribute("aria-selected", "false")
})

test("shows the redacted-query-text note for a Snowflake plan with redaction enabled", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("snowflake", "redacted-query-text.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByText(/redacted by account policy/i)).toBeVisible()
})

test("clicking a plan node opens its rich detail panel with glossary education, stats, and a close button", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()

  await page.getByTestId("plan-node-card").first().click()

  const panel = page.getByTestId("detail-panel")
  await expect(panel).toBeVisible()
  await expect(page.getByTestId("operator-education-what").or(page.getByTestId("operator-education-fallback"))).toBeVisible()
  await expect(page.getByTestId("stats-table")).toBeVisible()

  await page.getByRole("button", { name: "Close details" }).click()
  await expect(panel).toBeHidden()
})

test("recovers cleanly: an error followed by a valid paste shows the result, not a stale error", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "non-plan-text.txt"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("parse-error")).toBeVisible()

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("parse-error")).toHaveCount(0)
  await expect(page.getByTestId("plan-result")).toBeVisible()
})
