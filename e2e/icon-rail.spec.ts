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

    // Findings is independent of the New Plan/Recent Plans panel — it
    // toggles the bottom drawer, not a rail-adjacent overlay, and doesn't
    // require closing whatever's currently open first (the icon-rail
    // buttons stay clickable above the scrim at all times, a real bug
    // this story's own e2e run caught and fixed — see planReaderPage.css's
    // own comment on `.icon-rail__button`'s z-index).
    await page.getByTestId("icon-rail-findings").click()
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)

    // Closing Recent Plans (still open from above) confirms Findings
    // itself never opened the rail-adjacent overlay.
    await page.getByTestId("icon-rail-panel-close").click()
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
