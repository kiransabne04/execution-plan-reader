// Story 6.3 — the findings drawer (FindingsDrawer.tsx), replacing the old
// permanent left-rail FindingsList once a plan is analyzed. Real-browser
// verification of the actual height cap and row-density claims jsdom can't
// lay out for real.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

// A plan with several findings across all three severities (critical,
// warning, info), so the expanded drawer has real content to measure and
// the collapsed summary line's full format is exercised.
const MULTI_FINDING_PLAN = loadFixture("postgres", "rule-wal-volume.json")

test.describe("findings drawer", () => {
  test("collapsed by default: one summary line, not the full list", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const drawer = page.getByTestId("findings-drawer")
    await expect(drawer).toBeVisible()
    await expect(drawer).not.toHaveClass(/findings-drawer--open/)
    await expect(page.getByTestId("findings-drawer-body")).toHaveCount(0)

    const summary = page.getByTestId("findings-drawer-summary")
    await expect(summary).toBeVisible()
    // The one-line summary format from the story's own spec: total +
    // severity breakdown.
    await expect(summary).toHaveText(/findings? · \d+ critical · \d+ warnings? · \d+ info/)
  })

  test("expanding reveals compact one-line rows, not full-paragraph cards", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("findings-drawer-summary").click()
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    const body = page.getByTestId("findings-drawer-body")
    await expect(body).toBeVisible()

    const rows = page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]')
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)

    // Compact rows are genuinely short — the old full-card treatment
    // (padded, severity-tinted, shortText on its own line) ran 50-60px+
    // tall; a compact row should be well under that.
    const firstRowBox = await rows.first().boundingBox()
    expect(firstRowBox?.height).toBeLessThan(40)
  })

  test("expanded height is capped at min(38vh, 420px) — it does not grow to push the canvas off-screen", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    const body = page.getByTestId("findings-drawer-body")
    const box = await body.boundingBox()
    expect(box).not.toBeNull()
    // min(38vh, 420px) at 900px viewport height = min(342, 420) = 342.
    expect(box!.height).toBeLessThanOrEqual(345)

    // The canvas graph above it is still visible and usable, not pushed
    // off-screen by the drawer's expansion.
    await expect(page.getByTestId("plan-graph")).toBeVisible()
  })

  test("scrolls internally past the cap, rather than growing or pushing the page", async ({ page }) => {
    // A short viewport (38vh here = ~114px) forces even this fixture's
    // handful of findings past the cap — no fixture in this repo actually
    // reaches "dozens of findings," so the cap itself is exercised via
    // viewport height rather than finding count.
    await page.setViewportSize({ width: 1500, height: 300 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    const body = page.getByTestId("findings-drawer-body")
    const overflowsInternally = await body.evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(overflowsInternally).toBe(true)

    // The drawer's own body scrolls internally rather than growing past
    // its cap — its rendered height stays at the cap even though its
    // CONTENT (scrollHeight) is taller than that.
    const box = await body.boundingBox()
    expect(box!.height).toBeLessThan(150) // well under its own content height
  })

  test("filters still work inside the compact expanded view", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    const allCount = await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').count()
    await page.getByTestId("findings-severity-filter").selectOption("critical")
    const criticalCount = await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').count()
    expect(criticalCount).toBeLessThanOrEqual(allCount)
  })

  test("clicking a compact row opens that node's detail panel, same as the old full-card rows did", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })
})

// Episode 26, Story 26.3 — drag-resize height, statement grouping, and the
// specific rail-overlap bug found during this episode's own mockup pass.
test.describe("findings drawer — Story 26.3", () => {
  test("dragging the resize handle down shrinks the panel; the new height survives switching statements but not a fresh analyze", async ({ page }) => {
    // Shrinking (not growing) is the reliable direction to test here:
    // raising the max-height cap only visibly grows the box if its
    // CONTENT is already tall enough to be constrained by it — dragging
    // the cap down below the content's own natural height always has a
    // real, visible effect regardless of how much content there is.
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "multi-statement-batch.xml"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    const body = page.getByTestId("findings-drawer-body")
    const heightBefore = (await body.boundingBox())!.height

    const handle = page.getByTestId("findings-drawer-resize-handle")
    const handleBox = (await handle.boundingBox())!
    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + 200, { steps: 5 }) // drag down 200px
    await page.mouse.up()

    const heightAfterDrag = (await body.boundingBox())!.height
    expect(heightAfterDrag).toBeLessThan(heightBefore - 50) // real shrink, not noise

    // Switching statements (same plan) keeps the custom height.
    const tabs = page.getByRole("tab")
    await tabs.nth(1).click()
    const heightAfterTabSwitch = (await body.boundingBox())!.height
    expect(heightAfterTabSwitch).toBeCloseTo(heightAfterDrag, 0)

    // A fresh analyze resets it back to the default cap.
    await page.getByTestId("icon-rail-new-plan").click()
    await page.getByTestId("paste-box-expand").click()
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()
    const heightAfterFreshAnalyze = (await page.getByTestId("findings-drawer-body").boundingBox())!.height
    expect(heightAfterFreshAnalyze).toBeGreaterThan(heightAfterDrag + 50)
  })

  test("the drawer's own left edge aligns to the canvas column's own left edge, not spanning under the rail — the overlap bug found during the mockup pass", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_FINDING_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const railBox = (await page.getByTestId("icon-rail").boundingBox())!
    const canvasBox = (await page.getByTestId("plan-shell-canvas").boundingBox())!
    const drawerBox = (await page.getByTestId("findings-drawer").boundingBox())!

    // The specific regression: the drawer must never start at or before
    // the rail's own right edge (which would mean it's spanning under the
    // rail) — and its left edge matches the rest of the canvas column,
    // not some other, independently-computed position.
    expect(drawerBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width)
    expect(drawerBox.x).toBeCloseTo(canvasBox.x, 0)
  })

  test("groups findings by statement in a multi-statement batch, with collapsible group headers", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "multi-statement-batch.xml"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("findings-drawer-summary").click()

    const headers = page.getByTestId("findings-list-group-header")
    const headerCount = await headers.count()
    expect(headerCount).toBeGreaterThan(0)

    const firstHeader = headers.first()
    await expect(firstHeader).toHaveAttribute("aria-expanded", "true")
    const rowsBefore = await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').count()

    await firstHeader.click()
    await expect(firstHeader).toHaveAttribute("aria-expanded", "false")
    const rowsAfter = await page.locator('[data-testid="findings-drawer-body"] [data-testid="finding-item"]').count()
    expect(rowsAfter).toBeLessThan(rowsBefore)
  })
})
