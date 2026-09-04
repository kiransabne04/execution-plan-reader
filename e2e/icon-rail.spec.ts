// Story 6.3 — the icon rail (IconRail.tsx), replacing the old always-open
// left rail once a plan is analyzed. Real-browser verification: jsdom
// component tests cover the data-plumbing side (PlanReaderPage.test.tsx),
// this file covers the actual layout-space claim ("doesn't permanently
// reserve layout space while collapsed") jsdom can't lay out for real.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.describe("icon rail", () => {
  test("each icon opens its own panel; the rail itself never grows to reserve space", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const railBoxBefore = await page.getByTestId("icon-rail").boundingBox()
    expect(railBoxBefore?.width).toBeLessThan(80) // narrow rail, not a full rail width

    // New plan
    await page.getByTestId("icon-rail-new-plan").click()
    await expect(page.getByTestId("icon-rail-panel")).toBeVisible()
    await expect(page.getByTestId("paste-textarea")).toBeVisible()
    const railBoxDuring1 = await page.getByTestId("icon-rail").boundingBox()
    expect(railBoxDuring1?.width).toBeLessThan(80) // the rail itself stays narrow; the PANEL is a separate overlay
    await page.getByTestId("icon-rail-panel-close").click()
    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()

    // Recent plans (empty on a fresh profile — the section renders null,
    // but the icon itself must still be present and clickable without
    // throwing).
    await page.getByTestId("icon-rail-recent-plans").click()
    // No assertion on panel content here (may be empty) — just confirming
    // the click doesn't throw and the rail stays narrow.
    const railBoxDuring2 = await page.getByTestId("icon-rail").boundingBox()
    expect(railBoxDuring2?.width).toBeLessThan(80)

    // Findings toggles the bottom drawer, not a rail-adjacent overlay —
    // the icon-rail buttons stay clickable above the scrim at all times
    // (a real bug this story's own e2e run caught and fixed — see
    // planReaderPage.css's own comment on `.icon-rail__button`'s
    // z-index). Episode 26, Story 26.2: opening Findings/Issues now
    // explicitly closes Recent Plans first (still open from above) — the
    // two would otherwise occupy the same left column.
    await page.getByTestId("icon-rail-findings").click()
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()
  })

  test("New plan panel auto-collapses to the rail right after a successful analyze, and is re-openable", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    // The panel that was open pre-analysis (inline, not yet an icon rail)
    // is gone — replaced by the collapsed rail.
    await expect(page.getByTestId("icon-rail")).toBeVisible()
    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()

    // Re-openable, with the analyzed text still present (edit-and-
    // re-analyze is the story's own explicit requirement).
    await page.getByTestId("icon-rail-new-plan").click()
    await expect(page.getByTestId("paste-textarea")).toHaveValue(loadFixture("postgres", "simple-seq-scan.json"))
  })

  test("before any plan is analyzed, the input renders inline — the icon rail doesn't apply yet", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await expect(page.getByTestId("icon-rail")).toHaveCount(0)
    await expect(page.getByTestId("paste-textarea")).toBeVisible()
  })
})

// Episode 26, Story 26.2 — click-outside-close, real browser: a jsdom
// component test can assert the listener fired, but not that the panel's
// own scrim (now `pointer-events: none`) genuinely lets a real click
// reach whatever's underneath rather than being intercepted by the
// browser's own hit-testing, which only a real render can prove.
//
// The open panel itself is a real, OPAQUE, left-docked overlay up to
// 360px wide and full viewport height — an element genuinely positioned
// UNDER it (e.g. near the canvas's own top-left corner) is not reachable
// by a real click at all while it's open, same as it wouldn't be for an
// actual user. These tests click at a point past that footprint on a
// wide viewport, exactly the "click outside" case the AC means.
test.describe("icon rail — click-outside-close (Story 26.2)", () => {
  test("clicking inside the Findings drawer closes an open rail panel, and the click's own effect (opening that node's detail panel) still happens", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("icon-rail-findings").click() // opens the drawer, already expanded
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    await page.getByTestId("icon-rail-new-plan").click()
    await expect(page.getByTestId("icon-rail-panel")).toBeVisible()

    // The compact row spans nearly the full canvas width — click near its
    // own right edge, well past the open panel's ~416px-wide footprint.
    const row = page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').first()
    const box = (await row.boundingBox())!
    await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2)

    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })

  test("clicking the open, un-pinned detail panel's own scrim closes BOTH the detail panel and an open rail panel", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("accessible-list-toggle").click()
    await page.getByTestId("accessible-plan-list-item").first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()

    await page.getByTestId("icon-rail-new-plan").click()
    await expect(page.getByTestId("icon-rail-panel")).toBeVisible()

    // Well past the open panel's own footprint, still on the scrim
    // (a full-viewport fixed overlay).
    await page.getByTestId("plan-shell-detail-scrim").click({ position: { x: 900, y: 400 } })

    await expect(page.getByTestId("detail-panel")).not.toBeVisible()
    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()
  })
})
