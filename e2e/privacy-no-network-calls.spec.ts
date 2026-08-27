// The real-browser version of Episode 7's testing requirement that jsdom
// couldn't provide: "intercept all network calls during a full rule-based-
// path user flow (paste -> parse -> visualize -> view warnings) and assert
// none contain plan text, table/column names, or literal values." See
// .claude/skills/privacy-architecture/SKILL.md.
//
// The request listener is attached only AFTER the initial page load
// finishes, so the page's own document/JS/CSS asset fetches (expected,
// same-origin, harmless) aren't counted — the assertion is that the
// ANALYZE interaction itself causes zero network requests, not that the
// page loaded with zero.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test("zero outbound requests while analyzing a Postgres plan", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  const requestsDuringAnalysis: string[] = []
  page.on("request", (req) => requestsDuringAnalysis.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(500) // settle window for anything async

  expect(requestsDuringAnalysis).toEqual([])
})

test("zero outbound requests while analyzing a SQL Server plan and switching statements", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  const requestsDuringAnalysis: string[] = []
  page.on("request", (req) => requestsDuringAnalysis.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "multi-statement-batch.xml"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.getByRole("tab").nth(1).click()
  await page.waitForTimeout(500)

  expect(requestsDuringAnalysis).toEqual([])
})

test("zero outbound requests while analyzing a Snowflake plan", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  const requestsDuringAnalysis: string[] = []
  page.on("request", (req) => requestsDuringAnalysis.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("snowflake", "join-filter-aggregate.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(500)

  expect(requestsDuringAnalysis).toEqual([])
})

test("zero outbound requests even on a parse failure (no accidental error-telemetry call)", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  const requestsDuringAnalysis: string[] = []
  page.on("request", (req) => requestsDuringAnalysis.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "non-plan-text.txt"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("parse-error")).toBeVisible()
  await page.waitForTimeout(500)

  expect(requestsDuringAnalysis).toEqual([])
})
