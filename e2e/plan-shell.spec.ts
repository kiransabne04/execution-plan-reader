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
  // Story 6.3 — the detail panel is now an overlay by DEFAULT at every
  // shell width (never a grid track unless pinned open) — these two tests
  // replace this story's own pre-6.3 "1180px switches between grid-track
  // and overlay" pair. The grid-track behavior itself still exists and is
  // covered below, under the pin-preference describe block.
  test("the detail panel is a fixed overlay with a scrim behind it above 1180px too, by default (un-pinned)", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeGreaterThan(1180) // sanity: this test's premise actually holds at this viewport

    await page.getByTestId("plan-node-card").first().click()
    const panel = page.getByTestId("detail-panel")
    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveClass(/detail-panel--in-shell/)
    await expect(panel).toHaveCSS("position", "fixed")
    await expect(page.getByTestId("plan-shell-detail-scrim")).toBeVisible()
  })

  test("below 1180px, the detail panel is a fixed overlay with a scrim behind it (unchanged from before this story)", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(1180)

    await page.getByTestId("plan-node-card").first().click()
    const panel = page.getByTestId("detail-panel")
    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveClass(/detail-panel--in-shell/)
    await expect(panel).toHaveCSS("position", "fixed")

    const scrim = page.getByTestId("plan-shell-detail-scrim")
    await expect(scrim).toBeVisible()
    // The scrim closes the panel too, not just the panel's own × button —
    // a real modal-overlay affordance, not decorative.
    await scrim.click({ position: { x: 5, y: 5 } })
    await expect(panel).toBeHidden()
  })

  // Story 6.3 — "keep panel open" preference: pinning restores the exact
  // pre-6.3 grid-track behavior above 1180px, and stays a plain overlay
  // below it (matching DetailPanel's own `variant="shell"` degradation,
  // unchanged from Story 18.2).
  test.describe("pinned detail panel", () => {
    test("above 1180px, pinning switches the panel to a real grid track — position: static, no scrim", async ({ page }) => {
      await page.setViewportSize({ width: 1500, height: 900 })
      await page.goto("/")
      await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
      await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

      await page.getByTestId("plan-node-card").first().click()
      await page.getByTestId("detail-panel-pin").click()

      const panel = page.getByTestId("detail-panel")
      await expect(panel).toHaveClass(/detail-panel--in-shell/)
      await expect(panel).toHaveCSS("position", "static")
      await expect(page.getByTestId("plan-shell-detail-scrim")).toBeHidden()

      // A true grid track has real, non-degenerate size — the same
      // "height: 100%" bug Story 18.2 hit and fixed (detailPanel.css's own
      // comment): a stretched-grid-item + percentage-height child silently
      // collapsed to a zero-height, Playwright-"hidden" element.
      const box = await panel.boundingBox()
      expect(box?.height).toBeGreaterThan(200)
    })

    test("pinning survives closing and reselecting a different node", async ({ page }) => {
      await page.setViewportSize({ width: 1500, height: 900 })
      await page.goto("/")
      await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
      await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

      await page.getByTestId("plan-node-card").first().click()
      await page.getByTestId("detail-panel-pin").click()
      await expect(page.getByTestId("detail-panel")).toHaveClass(/detail-panel--in-shell/)

      await page.getByTestId("plan-node-card").nth(1).click()
      await expect(page.getByTestId("detail-panel")).toHaveClass(/detail-panel--in-shell/)
    })

    test("below 1180px, a pinned panel still degrades to the overlay+scrim treatment", async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 900 })
      await page.goto("/")
      await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
      await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

      await page.getByTestId("plan-node-card").first().click()
      await page.getByTestId("detail-panel-pin").click()

      const panel = page.getByTestId("detail-panel")
      await expect(panel).toHaveClass(/detail-panel--in-shell/)
      await expect(panel).toHaveCSS("position", "fixed")
    })
  })

  // Story 6.3 — RETIRES the "Findings/graph become tabs below 860px"
  // mechanism these two tests originally covered (`shell-tab-findings`/
  // `shell-tab-graph`, `plan-shell-left-rail` once analyzed): once
  // Findings lives in a bottom drawer INSIDE the canvas rather than a
  // competing side rail, the narrow icon rail (56px) comfortably coexists
  // with the canvas at any reasonable width — there's no longer a
  // meaningful choice between "Findings" and "Graph" to tab between (both
  // tabs would show near-identical content). Replaced with tests
  // confirming the icon rail + canvas (with its findings drawer) render
  // side by side at BOTH a narrow and a wide shell width, with no tabs of
  // any kind in the DOM.
  test("below 860px of the shell's own width, the icon rail and canvas (with its findings drawer) still render side by side — no tabs", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(860)

    await expect(page.getByTestId("icon-rail")).toBeVisible()
    await expect(page.getByTestId("plan-graph")).toBeVisible()
    await expect(page.getByTestId("findings-drawer")).toBeVisible()
    await expect(page.getByTestId("plan-shell-left-rail")).toHaveCount(0)
    await expect(page.getByTestId("shell-tab-findings")).toHaveCount(0)
    await expect(page.getByTestId("shell-tab-graph")).toHaveCount(0)
  })

  test("above 860px, the icon rail and canvas render side by side too — the same layout, no tab switch at any width", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await expect(page.getByTestId("icon-rail")).toBeVisible()
    await expect(page.getByTestId("plan-shell-canvas")).toBeVisible()
    await expect(page.getByTestId("findings-drawer")).toBeVisible()
    await expect(page.getByTestId("shell-tab-findings")).toHaveCount(0)
    await expect(page.getByTestId("shell-tab-graph")).toHaveCount(0)
  })

  test("the shell reads its own width, not the viewport's — narrower inside a narrower parent container", async ({ page }) => {
    // Spec §2's explicit design goal: "everything measures against the
    // shell's own width... so it behaves the same embedded or full-page."
    // Story 6.3's own 1180px pinned-detail-panel breakpoint is the signal
    // used here now (the 860px tabs signal this test originally used is
    // retired — see the two tests above).
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("plan-node-card").first().click()
    await page.getByTestId("detail-panel-pin").click()
    await expect(page.getByTestId("detail-panel")).toHaveClass(/detail-panel--in-shell/)

    // Squeeze the page's own container without touching the viewport —
    // container queries must respond to THIS, unlike @media.
    await page.evaluate(() => {
      const el = document.querySelector(".plan-reader-page") as HTMLElement
      el.style.maxWidth = "1000px"
    })
    await page.waitForTimeout(150)

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(1180)
    // The 1180px container-query breakpoint fired from the container
    // shrinking alone — the viewport itself never changed. A pinned panel
    // degrades to the fixed-overlay treatment below 1180px regardless of
    // pin state (matching plan-shell.spec.ts's own pinned-panel tests).
    await expect(page.getByTestId("detail-panel")).toHaveCSS("position", "fixed")
  })

  // Story 6.3 — every app-bar action button (Walk me through it, Compare,
  // Share, Export) is icon-only UNCONDITIONALLY now, superseding this
  // pre-6.3 pair's own "before wrapping below 860px" behavior (spec §2's
  // original wording scoped this to Share/Export only, at that one
  // breakpoint).
  test("app-bar action buttons are icon-only at every width — text hidden, accessible name unchanged, no app-bar overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeGreaterThan(860) // sanity: a WIDE shell, not a narrow one

    // The visually-hidden technique (clip-rect, 1px box) still has a
    // non-zero bounding box by Playwright's own definition of "visible" —
    // asserting on the actual box size is the correct check here, not
    // toBeHidden().
    const shareLabelBox = await page.locator(".share-link__button-label").boundingBox()
    expect(shareLabelBox?.width).toBeLessThan(2)
    const exportLabelBox = await page.locator(".plan-shell__app-bar-button-label").first().boundingBox()
    expect(exportLabelBox?.width).toBeLessThan(2)

    // Still reachable via their accessible name (aria-label/title text
    // identical to the old visible text), not visible text — the
    // icon-only state must stay a real, labeled button, not a
    // decoration-only one.
    await expect(page.getByRole("button", { name: "Copy shareable link" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Walk me through it" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Compare with another plan" })).toBeVisible()

    const overflowing = await page.locator(".plan-shell__app-bar").evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflowing).toBe(false)
  })

  test("app-bar action buttons stay icon-only and overflow-free at a narrower shell width too", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(MULTI_NODE_PLAN)
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("plan-node-card").first().waitFor()

    await page.evaluate(() => {
      const el = document.querySelector(".plan-reader-page") as HTMLElement
      el.style.maxWidth = "800px"
    })
    await page.waitForTimeout(150)

    const shellWidth = await page.locator(".plan-shell").evaluate((el) => el.getBoundingClientRect().width)
    expect(shellWidth).toBeLessThan(860)

    const shareLabelBox2 = await page.locator(".share-link__button-label").boundingBox()
    expect(shareLabelBox2?.width).toBeLessThan(2)
    const exportLabelBox2 = await page.locator(".plan-shell__app-bar-button-label").first().boundingBox()
    expect(exportLabelBox2?.width).toBeLessThan(2)
    await expect(page.getByRole("button", { name: "Copy shareable link" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Export as PNG" })).toBeVisible()

    const overflowing = await page.locator(".plan-shell__app-bar").evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflowing).toBe(false)
  })
})
