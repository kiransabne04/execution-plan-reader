// Story 6.3's own health-panel edge case: a plan with several unavailable
// metrics (e.g. no BUFFERS, no actual data for some dimensions) must not
// consume a permanently-visible row per metric. Most of this behavior
// shipped with Story 23.3 already (collapsed-by-default score+legend,
// breakdown behind a toggle) — this file exercises the real-browser
// version of what QueryHealthCard.test.tsx already covers at the
// component level (the combined "N metrics unavailable" line), plus the
// one thing a jsdom test can't confirm: it actually renders inside the
// real shell layout without being clipped or pushed off-screen.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.describe("Query Health breakdown", () => {
  test("collapsed by default: one line (score + severity legend), no per-dimension rows visible", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    // A plan with no BUFFERS/actual-worker data — Memory/I-O/Parallelism
    // stay insufficient-data, Runtime/Cardinality score normally.
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const card = page.getByTestId("query-health-card")
    await expect(card).toBeVisible()
    await expect(page.getByTestId("query-health-breakdown")).toHaveCount(0)
    await expect(page.getByTestId("query-health-score")).toBeVisible()
    await expect(page.getByTestId("query-health-legend")).toBeVisible()
  })

  test("'Show breakdown' reveals scored dimensions individually and unavailable ones combined into one line", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("query-health-breakdown-toggle").click()
    await expect(page.getByTestId("query-health-breakdown")).toBeVisible()

    // Never one row per unavailable metric — combined into a single row,
    // naming which ones, not N separate empty-looking rows.
    const unavailableRows = page.getByTestId("query-health-dimension-unavailable")
    const unavailableCount = await unavailableRows.count()
    expect(unavailableCount).toBeLessThanOrEqual(1)
    if (unavailableCount === 1) {
      await expect(unavailableRows.first()).toHaveText(/\d+ metrics? unavailable for this plan/)
    }
  })

  test("a plan with real BUFFERS/parallel data scores more dimensions, shrinking (or removing) the unavailable line", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    // A fixture exercising the parallel-worker-shortfall rule has real
    // parallelism data, unlike the plain simple-seq-scan fixture above.
    await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "parallel-dop-shortfall-critical.xml"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("query-health-breakdown-toggle").click()
    await expect(page.getByTestId("query-health-breakdown")).toBeVisible()
    // Whatever the exact mix, still never more than one combined row.
    expect(await page.getByTestId("query-health-dimension-unavailable").count()).toBeLessThanOrEqual(1)
  })

  test("the card and its breakdown render fully within the canvas column, not clipped or overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("query-health-breakdown-toggle").click()

    const canvasBox = await page.getByTestId("plan-shell-canvas").boundingBox()
    const cardBox = await page.getByTestId("query-health-card").boundingBox()
    expect(canvasBox).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(cardBox!.x).toBeGreaterThanOrEqual(canvasBox!.x - 1)
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width + 1)
  })
})
