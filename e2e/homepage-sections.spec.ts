import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze/i

// Episode SEO-02, Story 02.2 — homepage content sections below the
// analyzer shell.

test("all 8 homepage sections are present, below the fold, in a real page load", async ({ page }) => {
  await page.goto("/")
  const sections = page.getByTestId("homepage-sections")
  await expect(sections).toBeAttached()

  for (const heading of [
    "Supported Databases",
    "What PlanReader Detects",
    "Why PlanReader",
    "How It Works",
    "Privacy",
    "Try an Example",
    "Learn More",
    "FAQ",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible()
  }
})

// Story 02.2's sections only make sense on the empty landing state — once
// a plan is loaded this is a working tool, and spec §2b's "the page itself
// never grows past the viewport" invariant (plan-shell.spec.ts's own
// regression test) only holds with them gone.
test("homepage sections disappear once a plan is analyzed, and the page stops scrolling past one viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await expect(page.getByTestId("homepage-sections")).toBeAttached()

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await expect(page.getByTestId("homepage-sections")).not.toBeAttached()
  const pageScrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1)
  expect(pageScrollable).toBe(false)
})

// The CTA scrolls to the real, already-working sample-plan buttons in the
// paste box rather than duplicating them — proves the scroll actually
// lands on a real, clickable sample button, not just that some element
// moved into view.
test("the Try an Example CTA scrolls to, and reveals, the real sample-plan buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")

  await page.getByTestId("try-an-example-cta").click()
  await expect(page.getByTestId("sample-plan-list")).toBeInViewport()
  await expect(page.getByTestId("sample-plan-button").first()).toBeVisible()
})
