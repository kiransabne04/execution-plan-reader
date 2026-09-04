// Episode 26, Story 26.4 — the permanent status bar, verified in a real
// browser: jsdom can't lay out real CSS, so the "stays visible in every
// overlay combination" and "narrow shell width" claims need a real render.

import { test, expect } from "@playwright/test"
import { loadFixture, openPlanNode } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.describe("status bar", () => {
  test("renders before any plan is analyzed, with just the branding chip", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")

    const bar = page.getByTestId("plan-shell-status-bar")
    await expect(bar).toBeVisible()
    await expect(page.getByTestId("status-bar-brand")).toBeVisible()
    await expect(page.getByTestId("status-bar-engine")).toHaveCount(0)
  })

  // Real bug found via live verification (not jsdom-catchable — this is a
  // pure CSS layout issue): `overflow-x: auto` alone forces the OTHER
  // axis to compute as `auto` too, never `visible`, per the CSS spec — the
  // brand chip's own `bottom: 100%` popover was silently clipped by an
  // ancestor's overflow even though React had genuinely toggled it open.
  test("clicking the branding chip reveals its popover fully within the viewport, not clipped by the bar's own horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")

    await page.getByTestId("status-bar-brand").click()
    const about = page.getByTestId("status-bar-about")
    await expect(about).toBeVisible()
    await expect(about).toContainText(/scalingbackend/i)
    const box = (await about.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0) // genuinely on-screen, not clipped to a zero/negative-height box
    expect(box.height).toBeGreaterThan(10)
  })

  test("shows engine/node/severity data once analyzed, and stays visible with the icon-rail sidebar open", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await expect(page.getByTestId("status-bar-engine")).toHaveText("Postgres")
    await expect(page.getByTestId("status-bar-node-count")).toBeVisible()
    await expect(page.getByTestId("status-bar-severity-counts")).toBeVisible()

    await page.getByTestId("icon-rail-new-plan").click()
    await expect(page.getByTestId("plan-shell-status-bar")).toBeVisible()
  })

  test("stays visible with the detail panel open", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await openPlanNode(page)
    await expect(page.getByTestId("detail-panel")).toBeVisible()
    await expect(page.getByTestId("plan-shell-status-bar")).toBeVisible()
  })

  test("stays visible with the Issues drawer open, and its own severity-counts button toggles the SAME drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("status-bar-severity-counts").click()
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    await expect(page.getByTestId("plan-shell-status-bar")).toBeVisible()
  })

  test("is intentionally covered by the maximized overlay, same as the app bar already is — not left visible above it by accident", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const barBoxBefore = (await page.getByTestId("plan-shell-status-bar").boundingBox())!
    const centerX = barBoxBefore.x + barBoxBefore.width / 2
    const centerY = barBoxBefore.y + barBoxBefore.height / 2

    await page.getByTestId("graph-maximize-toggle").click()
    await expect(page.getByTestId("plan-shell-graph")).toHaveClass(/plan-shell__graph--maximized/)

    // Still present in the DOM (not conditionally unmounted)...
    await expect(page.getByTestId("plan-shell-status-bar")).toHaveCount(1)
    // ...but whatever's actually on top at its own former screen position
    // is the maximized overlay, not the status bar itself.
    const topElementIsInsideMaximizedGraph = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest(".plan-shell__graph--maximized")
      },
      [centerX, centerY],
    )
    expect(topElementIsInsideMaximizedGraph).toBe(true)
  })

  test("does not overflow a narrow (mobile) shell width — the specific class of bug Story 6.3 hit for the app bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await expect(page.getByTestId("plan-shell-status-bar")).toBeVisible()
    // The bar's own content may legitimately scroll internally at this
    // width (same `overflow-x: auto` approach the app bar above it
    // already uses) — the real, checkable claim is that the PAGE itself
    // never gains horizontal scroll from it.
    const pageOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(pageOverflowing).toBe(false)
  })
})
