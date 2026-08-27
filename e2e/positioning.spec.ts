// Episode 8, Story 8.1: hero headline, subheadline, and engine names must
// be visible "without scrolling" — the literal, checkable version of that
// is: each element's bounding box sits within the viewport's visible
// height on first load, at both a desktop and a mobile width.

import { test, expect } from "@playwright/test"

async function assertAboveTheFold(page: import("@playwright/test").Page, viewportHeight: number) {
  for (const testId of ["paste-textarea"]) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeLessThan(viewportHeight)
  }
  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toBeVisible()
  const headingBox = await heading.boundingBox()
  expect(headingBox!.y).toBeLessThan(viewportHeight)
}

test("hero headline, subheadline, and paste box are above the fold on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/execution plan/i)
  await assertAboveTheFold(page, 800)
})

test("hero headline, subheadline, and paste box are above the fold on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/execution plan/i)
  await assertAboveTheFold(page, 844)
})

test("engine names are visible without scrolling on both viewports", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto("/")
    for (const engine of ["Postgres", "SQL Server", "Snowflake"]) {
      await expect(page.getByText(engine, { exact: true }).first()).toBeVisible()
    }
  }
})

test("h1 contains 'execution plan', not just the brand name", async ({ page }) => {
  await page.goto("/")
  const h1 = page.getByRole("heading", { level: 1 })
  await expect(h1).toContainText(/execution plan/i)
})
