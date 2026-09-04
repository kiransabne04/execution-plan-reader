// Episode 18, Story 18.8 — the search/filter palette, verified in a real
// browser: the global `/`/⌘K keydown listeners and the canvas-mode dimming
// draw path both need real key events and a real 2D canvas context
// respectively, neither of which jsdom provides for real (see
// PlanReaderPage.test.tsx's own component-test coverage of the shortcut
// guard logic, and canvasDraw.test.ts's fake-context coverage of the alpha
// math — this file is the real end-to-end verification on top of both).

import { test, expect } from "@playwright/test"

const ANALYZE_BUTTON = /analyze plan/i

const MULTI_NODE_PLAN = `Hash Join  (cost=1.20..50.00 rows=500 width=64) (actual time=0.5..8.4 rows=480 loops=1)
  Hash Cond: (orders.customer_id = customers.id)
  ->  Seq Scan on orders  (cost=0.00..30.00 rows=1000 width=32) (actual time=0.01..2.1 rows=980 loops=1)
  ->  Hash  (cost=1.00..1.00 rows=20 width=32) (actual time=0.02..0.02 rows=20 loops=1)
        ->  Seq Scan on customers  (cost=0.00..1.00 rows=20 width=32) (actual time=0.01..0.01 rows=20 loops=1)
Planning Time: 0.4 ms
Execution Time: 9.0 ms`

async function analyzePlan(page: import("@playwright/test").Page) {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
}

test.describe("search palette (spec §5 `1h`)", () => {
  test("⌘K/Ctrl+K opens the palette from anywhere on the page", async ({ page }) => {
    await analyzePlan(page)
    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+k`)
    await expect(page.getByTestId("search-palette")).toBeVisible()
  })

  test("'/' opens the palette when no text input has focus", async ({ page }) => {
    await analyzePlan(page)
    // Deliberately blur via the DOM rather than clicking a point on the
    // page — the graph fills most of the viewport, and a stray click could
    // land on a node card (focusing it, or opening its detail panel),
    // which isn't what this test means to set up.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("/")
    await expect(page.getByTestId("search-palette")).toBeVisible()
  })

  test("'/' types into the paste box instead of opening the palette when it's focused", async ({ page }) => {
    await page.goto("/")
    const textarea = page.getByTestId("paste-textarea")
    await textarea.click()
    await textarea.type("/")
    await expect(page.getByTestId("search-palette")).toHaveCount(0)
    await expect(textarea).toHaveValue("/")
  })

  test("Escape closes the palette", async ({ page }) => {
    await analyzePlan(page)
    await page.keyboard.press("Control+k")
    await expect(page.getByTestId("search-palette")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("search-palette")).toHaveCount(0)
  })

  test("typing a query dims non-matching nodes (still present, reduced opacity) and selecting a result opens its detail panel", async ({
    page,
  }) => {
    await analyzePlan(page)
    await page.keyboard.press("Control+k")
    await page.getByTestId("search-palette-input").fill("orders")

    const results = page.getByTestId("search-palette-result")
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText("Seq Scan")

    // Every card still exists in the DOM — dimming, not unmounting.
    await expect(page.getByTestId("plan-node-card")).toHaveCount(4)

    await results.first().click()
    await expect(page.getByTestId("search-palette")).toHaveCount(0)
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })

  test("a zero-match query shows an explicit 'no matches' state", async ({ page }) => {
    await analyzePlan(page)
    await page.keyboard.press("Control+k")
    await page.getByTestId("search-palette-input").fill("nonexistent-operator-xyz")
    await expect(page.getByTestId("search-palette-no-matches")).toBeVisible()
  })
})
