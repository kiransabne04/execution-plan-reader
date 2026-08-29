// Episode 18, Story 18.2 — the app shell's container-query-driven
// breakpoints, verified in a real browser: jsdom implements neither CSS
// container queries nor real layout, so PlanReaderPage.test.tsx's
// component tests can only exercise the "wide" branch (see that file's
// own comment). This is the real verification the story's testing
// approach calls for.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

const MULTI_NODE_PLAN = `Hash Join  (cost=1.20..50.00 rows=500 width=64) (actual time=0.5..8.4 rows=480 loops=1)
  Hash Cond: (orders.customer_id = customers.id)
  ->  Seq Scan on orders  (cost=0.00..30.00 rows=1000 width=32) (actual time=0.01..2.1 rows=980 loops=1)
  ->  Hash  (cost=1.00..1.00 rows=20 width=32) (actual time=0.02..0.02 rows=20 loops=1)
        ->  Seq Scan on customers  (cost=0.00..1.00 rows=20 width=32) (actual time=0.01..0.01 rows=20 loops=1)
Planning Time: 0.4 ms
Execution Time: 9.0 ms`

test.describe("app shell breakpoints (spec §2)", () => {
  test("above 1180px of the shell's own width, the detail panel is a real grid track — position: static, no scrim", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeGreaterThan(1180) // sanity: this test's premise actually holds at this viewport

    await page.getByTestId("plan-node-card").first().click()
    const panel = page.getByTestId("detail-panel")
    await expect(panel).toBeVisible()
    await expect(panel).toHaveClass(/detail-panel--in-shell/)
    await expect(panel).toHaveCSS("position", "static")
    // The scrim element exists in the DOM whenever the panel is open at
    // ANY width (`.plan-shell__detail-scrim { display: none }` is the
    // default, only shown below 1180px) — hidden, not absent, here.
    await expect(page.getByTestId("plan-shell-detail-scrim")).toBeHidden()

    // A true grid track has real, non-degenerate size — this is the same
    // "height: 100%" bug this story hit and fixed (see detailPanel.css's
    // comment): a stretched-grid-item + percentage-height child silently
    // collapsed to a zero-height, Playwright-"hidden" element.
    const box = await panel.boundingBox()
    expect(box?.height).toBeGreaterThan(200)
  })

  test("below 1180px, the detail panel is a fixed overlay with a scrim behind it", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(1180)

    await page.getByTestId("plan-node-card").first().click()
    const panel = page.getByTestId("detail-panel")
    await expect(panel).toBeVisible()
    // The `--in-shell` class itself is always present (it's what makes the
    // `@container` rule apply in the first place) — it's the COMPUTED
    // position that changes with width, not the class.
    await expect(panel).toHaveClass(/detail-panel--in-shell/)
    await expect(panel).toHaveCSS("position", "fixed")

    const scrim = page.getByTestId("plan-shell-detail-scrim")
    await expect(scrim).toBeVisible()
    // The scrim closes the panel too, not just the panel's own × button —
    // a real modal-overlay affordance, not decorative.
    await scrim.click({ position: { x: 5, y: 5 } })
    await expect(panel).toBeHidden()
  })

  test("below 860px, Findings and the graph become tabs instead of a side-by-side rail+canvas", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(860)

    // Graph tab active by default at this width.
    await expect(page.getByTestId("shell-tab-graph")).toHaveAttribute("aria-selected", "true")
    await expect(page.getByTestId("plan-graph")).toBeVisible()
    await expect(page.getByTestId("plan-shell-left-rail")).toHaveCount(0)

    // Each tab button has a real, sane size — the exact regression this
    // story's own align-content bug produced (a ~130px-tall tab button
    // from an unconstrained grid row absorbing the container's min-height).
    const tabBox = await page.getByTestId("shell-tab-findings").boundingBox()
    expect(tabBox?.height).toBeLessThan(60)

    await page.getByTestId("shell-tab-findings").click()
    await expect(page.getByTestId("shell-tab-findings")).toHaveAttribute("aria-selected", "true")
    await expect(page.getByTestId("plan-shell-left-rail")).toBeVisible()
    await expect(page.getByTestId("findings-list")).toBeVisible()
    await expect(page.getByTestId("plan-shell-canvas")).toHaveCount(0)
  })

  test("above 860px, Findings and the graph render side by side with no tabs", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await expect(page.getByTestId("plan-shell-left-rail")).toBeVisible()
    await expect(page.getByTestId("plan-shell-canvas")).toBeVisible()
    await expect(page.getByTestId("shell-tab-findings")).toHaveCount(0)
    await expect(page.getByTestId("shell-tab-graph")).toHaveCount(0)
  })

  test("the shell reads its own width, not the viewport's — narrower inside a narrower parent container", async ({ page }) => {
    // Spec §2's explicit design goal: "everything measures against the
    // shell's own width... so it behaves the same embedded or full-page."
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("plan-node-card").first().waitFor()

    // Squeeze the page's own container without touching the viewport —
    // container queries must respond to THIS, unlike @media.
    await page.evaluate(() => {
      const el = document.querySelector(".plan-reader-page") as HTMLElement
      el.style.maxWidth = "700px"
    })
    await page.waitForTimeout(150)

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(860)
    // The 860px container-query breakpoint fired from the container
    // shrinking alone — the viewport itself never changed.
    await expect(page.getByTestId("shell-tab-graph")).toBeVisible()
  })

  // Spec §2: "Share and Export drop to icon-only before wrapping." 859px
  // (matching `NARROW_SHELL_BREAKPOINT_PX`'s own 860px) is a measured, not
  // assumed, threshold — see planReaderPage.css's own comment on the
  // throwaway script this was re-measured with, including the brand-mark
  // icon added in the same design-mockup-review pass (which widened the
  // app bar enough to invalidate an earlier, narrower measurement).
  test("above 860px, Share and Export show icon + full text", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeGreaterThan(860)

    await expect(page.locator(".share-link__button-label")).toBeVisible()
    await expect(page.locator(".share-link__button-label")).toHaveText("Copy shareable link")
    await expect(page.locator(".plan-shell__app-bar-button-label")).toBeVisible()
    await expect(page.locator(".plan-shell__app-bar-button-label")).toHaveText("Export")
  })

  test("below 860px of the shell's own width, Share and Export drop to icon-only — text hidden, accessible name unchanged, no app-bar overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("plan-node-card").first().waitFor()

    // 800px (not the 700px this test originally used): the whole point of
    // this test is confirming the icon-only band is genuinely overflow-
    // free, and 620–750px has its own separate, pre-existing, documented
    // gap unrelated to Share/Export (other app-bar buttons that don't
    // shrink) — see planReaderPage.css's own comment. Squeezing this far
    // into that unrelated gap would make this test flaky for a reason
    // that has nothing to do with what it's actually checking.
    await page.evaluate(() => {
      const el = document.querySelector(".plan-reader-page") as HTMLElement
      el.style.maxWidth = "800px"
    })
    await page.waitForTimeout(150)

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(860)

    await expect(page.locator(".share-link__button-label")).toBeHidden()
    await expect(page.locator(".plan-shell__app-bar-button-label")).toBeHidden()
    // Still reachable via their accessible name (aria-label), not just
    // visible text — the icon-only state must stay a real button, not a
    // decoration-only one.
    await expect(page.getByRole("button", { name: "Copy shareable link" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeVisible()

    // The whole point of dropping to icon-only "before wrapping" — the
    // app bar's natural content must actually fit now, not just look
    // different while still needing to scroll to reach these buttons.
    const overflowing = await page.locator(".plan-shell__app-bar").evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflowing).toBe(false)
  })
})
