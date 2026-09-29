import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze/i

// SEO indexing infrastructure story — Requirement 3: self-referencing
// canonical URL. Real-browser check (unit tests already cover the static
// index.html string, but this confirms the tag actually lands in the
// rendered DOM at the URL search engines see) that a plain load of "/"
// carries exactly one canonical tag pointing at the production origin,
// with no query string or fragment appended.
test("homepage has a single self-referencing canonical tag with no query/fragment", async ({ page }) => {
  await page.goto("/")
  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveCount(1)
  await expect(canonical).toHaveAttribute("href", "https://www.planreader.dev/")
})

// Requirement 6: a share-link URL must never become an indexable search
// page. Exercises the real UI (paste -> copy link -> open in a fresh
// navigation) rather than hand-building a fragment, so it also proves the
// noindex tag survives a genuine full page load/mount, not just a React
// re-render in a jsdom unit test.
test("a URL opened from a copied share link carries a noindex/nofollow meta tag; a plain load of / does not", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])

  await page.goto("/")
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByRole("button", { name: /copy shareable link/i }).click()
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedUrl).toContain("#plan=")

  // A fresh tab, not page.goto() on the existing page: a URL differing only
  // by fragment from the page's current URL is a same-document navigation
  // in Chromium (no reload, mount-time effects don't re-run) — that's not
  // what a real recipient opening a shared link experiences (a brand new
  // navigation, no prior document at that origin), and it would make this
  // assertion pass vacuously regardless of whether the noindex effect
  // actually runs on a genuine load.
  const sharedPage = await context.newPage()
  await sharedPage.goto(copiedUrl)
  await expect(sharedPage.getByTestId("plan-result")).toBeVisible()
  await expect(sharedPage.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1)
})
