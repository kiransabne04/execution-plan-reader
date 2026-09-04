// Story 6.3 — the story's own accountability bar: canvas area as a
// percentage of the viewport should go from roughly a third to the large
// majority, by default (nothing selected, all panels collapsed). This is
// the ONE test in this story's own required suite that measures actual
// pixel area rather than just "did the right element appear" — the kind
// of check that caught two of the three real bugs this story's own e2e
// pass found (see icon-rail.spec.ts/findings-drawer.spec.ts's own commit
// history): jsdom can't lay out real CSS Grid, so a component test can't
// catch a grid-placement bug that silently shrinks the canvas to nothing.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i
const VIEWPORT = { width: 1500, height: 900 }

test.describe("canvas real estate", () => {
  test("default state: canvas occupies the large majority of the viewport, not roughly a third", async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await page.getByTestId("plan-node-card").first().waitFor()

    const canvasBox = await page.getByTestId("plan-shell-canvas").boundingBox()
    expect(canvasBox).not.toBeNull()
    const canvasArea = canvasBox!.width * canvasBox!.height
    const viewportArea = VIEWPORT.width * VIEWPORT.height
    const ratio = canvasArea / viewportArea

    // Measured directly against `main` (pre-Story-6.3) at this exact
    // viewport/fixture: ~40% of the full viewport (this branch: ~72%).
    // The story's own bar is "the large majority" — asserting a
    // concrete, real floor here (not just "bigger than before") so a
    // future regression that shrinks the canvas back down gets caught by
    // this exact number, not a vague comparison.
    expect(ratio).toBeGreaterThan(0.65)
  })

  test("selecting a node opens a true overlay — the canvas's own box does not change size or position", async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const before = await page.getByTestId("plan-shell-canvas").boundingBox()

    await page.getByTestId("plan-node-card").first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()

    const during = await page.getByTestId("plan-shell-canvas").boundingBox()
    expect(during).toEqual(before) // byte-for-byte the same box — a real overlay, not a reflow
  })

  test("closing the overlay (× control) restores the canvas to its exact default size immediately", async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const before = await page.getByTestId("plan-shell-canvas").boundingBox()

    await page.getByTestId("plan-node-card").first().click()
    await expect(page.getByTestId("detail-panel")).toBeVisible()

    await page.getByRole("button", { name: "Close details" }).click()
    await expect(page.getByTestId("detail-panel")).toBeHidden()

    const after = await page.getByTestId("plan-shell-canvas").boundingBox()
    expect(after).toEqual(before)
  })

  test("closing via the scrim (clicking empty canvas-adjacent space) also restores the canvas", async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    const before = await page.getByTestId("plan-shell-canvas").boundingBox()
    await page.getByTestId("plan-node-card").first().click()
    await page.getByTestId("plan-shell-detail-scrim").click({ position: { x: 5, y: 5 } })
    await expect(page.getByTestId("detail-panel")).toBeHidden()

    const after = await page.getByTestId("plan-shell-canvas").boundingBox()
    expect(after).toEqual(before)
  })
})
