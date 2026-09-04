// Story 6.3's own combined-open-state edge case: an open, un-pinned detail
// panel (a fixed overlay anchored to the viewport's right edge) and the
// findings drawer's expanded body could otherwise visually collide in the
// bottom-right corner — two independently-built overlays with no
// coordination between them by default.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.describe("combined open state", () => {
  test("detail overlay + expanded findings drawer: both fully visible, neither clips or hides the other", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("plan-node-card").first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()

    await page.getByTestId("findings-drawer-summary").click()
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--inset/)

    // Both are genuinely visible and independently usable — clicking a
    // finding still opens/updates the (still-open) detail panel, and the
    // detail panel's own close button is still reachable, neither
    // obscured behind the other.
    const detailPanelBox = await page.getByTestId("detail-panel").boundingBox()
    const drawerBox = await page.getByTestId("findings-drawer").boundingBox()
    expect(detailPanelBox).not.toBeNull()
    expect(drawerBox).not.toBeNull()

    // The drawer visibly insets away from the panel's known width — its
    // own right edge stops short of the viewport's right edge (unlike the
    // un-inset case, where it would span nearly the full canvas width).
    expect(drawerBox!.x + drawerBox!.width).toBeLessThan(detailPanelBox!.x + 5)

    await expect(page.getByRole("button", { name: "Close details" })).toBeVisible()
    await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })

  test("the canvas graph is still visible between the two open surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("plan-node-card").first().click()
    await page.getByTestId("findings-drawer-summary").click()

    await expect(page.getByTestId("plan-graph")).toBeVisible()
  })

  test("a PINNED detail panel does not trigger the inset — it's a real grid track, not an overlay competing for the same space", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("plan-node-card").first().click()
    await page.getByTestId("detail-panel-pin").click()
    await expect(page.getByTestId("detail-panel")).toHaveClass(/detail-panel--in-shell/)

    await page.getByTestId("findings-drawer-summary").click()
    await expect(page.getByTestId("findings-drawer")).not.toHaveClass(/findings-drawer--inset/)
  })
})
