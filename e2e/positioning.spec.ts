// Episode 19 superseded Episode 8, Story 8.1's hero (headline/subheadline/
// engine badges, always above the fold, no loading gate): the three-column
// shell is now the app's only page from first load, and Plan Input lives in
// its left rail instead of a full-page paste form under a marketing hero.
// This file used to check the retired hero's above-the-fold placement;
// rewritten (not deleted) to check the same underlying promise — nothing
// plan-specific is gated behind a loading state, and the thing a first-time
// visitor actually needs (Plan Input) is immediately usable without
// scrolling — for the new default view. See
// docs/08-episodes-and-stories.md's Episode 19 header for the full account.

import { test, expect } from "@playwright/test"

async function assertAboveTheFold(page: import("@playwright/test").Page, viewportHeight: number) {
  for (const testId of ["paste-textarea", "plan-result"]) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeLessThan(viewportHeight)
  }
}

test("the shell and Plan Input are above the fold on desktop, immediately (no loading gate)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("paste-textarea")).toBeVisible()
  await assertAboveTheFold(page, 800)
})

test("the shell and Plan Input are above the fold on a mobile viewport, immediately (no loading gate)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("paste-textarea")).toBeVisible()
  await assertAboveTheFold(page, 844)
})

test("no separate hero/landing page precedes the shell — it's the only page, from the very first paint", async ({ page }) => {
  await page.goto("/")
  // The shell (brand, Plan Input) is present immediately, with no plan
  // analyzed yet — no intermediate hero screen ever renders in front of it.
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("plan-shell-empty-placeholder")).toBeVisible()
  // Episode 26, Story 26.4's own status-bar branding chip also reads
  // "PlanReader" now — scoped to the app bar's own brand mark specifically,
  // not a bare text match (which would now resolve to both).
  await expect(page.locator(".plan-shell__app-bar").getByText("PlanReader", { exact: true })).toBeVisible()
})
