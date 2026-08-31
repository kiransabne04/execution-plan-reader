// Episode 17 — real-browser proof that the persistence layer actually
// works against a REAL IndexedDB implementation, not just fake-indexeddb
// (spec-faithful, but still a different engine — see
// src/persistence/__tests__/ and src/__tests__/setup.ts for the unit-test
// side of this).

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  // A clean IndexedDB per test — the dev server is a shared origin across
  // Playwright's parallel workers/tests, so a previous test's saved
  // session could otherwise bleed into this one.
  await page.evaluate(() => indexedDB.deleteDatabase("planreader"))
  await page.reload()
})

test("a saved session survives a reload and can be restored", async ({ page }) => {
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(700) // past the save debounce

  await page.reload()
  await expect(page.getByTestId("restore-session-banner")).toBeVisible()

  await page.getByTestId("restore-session-button").click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Postgres")
})

test("dismissing the restore banner keeps the session available on the next reload", async ({ page }) => {
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(700)

  await page.reload()
  await expect(page.getByTestId("restore-session-banner")).toBeVisible()
  await page.getByTestId("dismiss-restore-button").click()
  await expect(page.getByTestId("restore-session-banner")).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId("restore-session-banner")).toBeVisible()
})

test("an analyzed plan appears in the recent plans list and can be reopened", async ({ page }) => {
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByTestId("recent-plans-toggle").click()
  await expect(page.getByTestId("recent-plan-item").first()).toBeVisible()

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Postgres")

  // Already expanded from the toggle click above — the list just gained a
  // second entry, no need to toggle again.
  const items = page.getByTestId("recent-plan-item")
  await expect(items).toHaveCount(2)
  // Reopen the first-added one (now the older of the two).
  await items.last().click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
})

test("checking 'don't save' keeps this plan out of both the session and the recent plans list", async ({ page }) => {
  // Tucked behind the "Privacy & storage settings" disclosure (design
  // review) — open it before reaching for the checkbox inside.
  await page.getByTestId("privacy-details-toggle").click()
  await page.getByTestId("dont-save-checkbox").check()
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(700)

  await expect(page.getByTestId("recent-plans-list")).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId("restore-session-banner")).toHaveCount(0)
})

test("'Clear saved data' removes both the saved session and the recent plans list", async ({ page }) => {
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await page.waitForTimeout(700)

  await page.getByTestId("privacy-details-toggle").click()
  await expect(page.getByTestId("clear-saved-data-button")).toBeVisible()
  await page.getByTestId("clear-saved-data-button").click()
  await expect(page.getByTestId("clear-saved-data-button")).toHaveCount(0)
  await expect(page.getByTestId("recent-plans-list")).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId("restore-session-banner")).toHaveCount(0)
})
