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
import { fileURLToPath } from "node:url"
import path from "node:path"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i
const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/fixtures")

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

// Story 11.2: loading a client-side-only shareable link must never send its
// fragment content in any network request — this is structurally guaranteed
// by the URL fragment itself (browsers never include it in a request line),
// but this test makes that guarantee explicit and regression-checkable
// rather than merely assumed. Uses the real UI end-to-end (paste -> copy
// link -> read from clipboard -> open in a fresh page) rather than
// hand-building a fragment, so it also exercises the actual "copy shareable
// link" button, not just the underlying encode function.
test("Story 11.2: a real copied share link decodes/renders locally with the fragment never appearing in any request", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])

  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "seek-and-key-lookup.xml"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByRole("button", { name: /copy shareable link/i }).click()
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedUrl).toContain("#plan=")
  const compressedValue = copiedUrl.split("#plan=")[1]

  const allRequestUrls: string[] = []
  page.on("request", (req) => allRequestUrls.push(req.url()))

  await page.goto(copiedUrl)
  // Renders directly from the fragment — no re-paste, no re-click.
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("SQL Server")
  await page.waitForTimeout(500)

  for (const url of allRequestUrls) {
    expect(url).not.toContain(compressedValue)
    expect(url).not.toContain("plan=")
  }
})

// Episode 17's own explicit testing requirement: "confirm the persistence
// mechanism itself never transmits stored data anywhere — this is a new
// code path that touches the same sensitive content the rest of the
// privacy architecture protects, so it needs its own explicit check, not
// an assumption that Episode 7's existing guarding covers it too." Drives
// the full save -> reload -> restore -> recent-plans-list round trip
// through IndexedDB with network interception active throughout.
test("Story 17.1/17.2: zero outbound requests across the full local-persistence round trip (save, reload, restore, browse recent plans)", async ({
  page,
}) => {
  await page.goto("/")

  const requests: string[] = []
  page.on("request", (req) => requests.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  // Past the debounce window so the session save actually lands before reload.
  await page.waitForTimeout(700)

  await page.reload()
  // A reload's own same-origin document/JS/CSS asset fetches are expected
  // and harmless (same reasoning as the listener-attached-after-goto
  // pattern above) — reset the log right after so the assertion below is
  // specifically about what happens from here on: loading the restored
  // session out of IndexedDB, clicking Restore, browsing recent plans, and
  // clearing saved data.
  requests.length = 0
  await expect(page.getByTestId("restore-session-banner")).toBeVisible()
  await page.getByTestId("restore-session-button").click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByTestId("recent-plans-toggle").click()
  await expect(page.getByTestId("recent-plan-item").first()).toBeVisible()
  await page.getByTestId("clear-saved-data-button").click()

  await page.waitForTimeout(300)
  expect(requests).toEqual([])
})

// Episode 14, Story 14.2: comparing two plans runs the exact same
// analyzePlanText/matchNodes pipeline twice, entirely client-side — this
// makes that explicit and regression-checkable rather than assumed, same
// reasoning as the Episode 17 test above.
test("Story 14.2: zero outbound requests while comparing two plans, including a synced-selection click", async ({ page }) => {
  await page.goto("/")

  const requests: string[] = []
  page.on("request", (req) => requests.push(req.url()))

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByTestId("compare-toggle").click()
  await page.getByTestId("compare-paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByTestId("compare-paste-submit").click()
  await expect(page.getByTestId("plan-comparison-view")).toBeVisible()

  await page.getByTestId("plan-graph").first().getByTestId("plan-node-card").first().click()
  await page.waitForTimeout(500)

  expect(requests).toEqual([])
})

// Episode 18, Story 18.5: two new input paths into the same client-side
// pipeline (a picked file, read via FileReader; a bundled sample plan) —
// each needs its own explicit check, same reasoning as every other new
// code path in this list, not an assumption that the paste-path guarding
// above covers them too.
test("Story 18.5: zero outbound requests when picking a file or loading a sample plan", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  const requests: string[] = []
  page.on("request", (req) => requests.push(req.url()))

  await page.setInputFiles(
    "[data-testid='file-picker-input']",
    path.join(FIXTURES_ROOT, "sqlserver", "missing-index-recommendation.xml"),
  )
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(300)

  await page.getByTestId("sample-plan-snowflake").click()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Snowflake")
  await page.waitForTimeout(300)

  expect(requests).toEqual([])
})

// Episode 18, Story 18.11: PNG export produces a real downloadable file —
// a new user-triggered action producing output, exactly the kind of new
// code path this list requires its own explicit check for (same reasoning
// Episode 17 and Story 18.5 above both already used), not an assumption
// that canvas rendering being local implies export is too.
test("Story 18.11: zero outbound requests during a PNG export", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  const requests: string[] = []
  page.on("request", (req) => requests.push(req.url()))

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("export-png-button").click()
  await downloadPromise

  expect(requests).toEqual([])
})
