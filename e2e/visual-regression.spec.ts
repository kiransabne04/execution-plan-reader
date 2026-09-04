// Episode 6, Story 6.1 testing approach: "Visual regression tests (snapshot
// rendering) across the fixture library, covering small/simple through
// large/complex plans." Baseline images are committed alongside this spec
// (visual-regression.spec.ts-snapshots/) and were captured in this
// project's own CI/dev environment — like any pixel-diff visual test, a
// baseline generated on one machine/font-rendering setup isn't guaranteed
// to match pixel-for-pixel on a different one; re-generate with
// `playwright test --update-snapshots` if that ever causes false failures
// on a genuinely unchanged UI.

import { test, expect } from "@playwright/test"
import { loadFixture, openPlanNode } from "./testUtils.js"

// Episode 26, Story 26.1 — canvas is now the only rendering path, so these
// baselines capture the canvas bitmap, not a React Flow DOM tree — they
// were regenerated (`playwright test --update-snapshots`) against this
// story's own rendering, superseding the pre-canvas-only baselines.

test("small/simple plan graph renders consistently", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: /analyze plan/i }).click()
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()
  // Let the canvas path's own fit-to-view settle before capturing.
  await page.waitForTimeout(300)

  await expect(page.getByTestId("plan-graph")).toHaveScreenshot("small-plan-graph.png")
})

test("larger/multi-branch plan graph renders consistently", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "seek-and-key-lookup.xml"))
  await page.getByRole("button", { name: /analyze plan/i }).click()
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()
  await page.waitForTimeout(300)

  await expect(page.getByTestId("plan-graph")).toHaveScreenshot("larger-plan-graph.png")
})

test("the node detail panel renders consistently", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: /analyze plan/i }).click()
  await openPlanNode(page)
  await expect(page.getByTestId("detail-panel")).toBeVisible()

  await expect(page.getByTestId("detail-panel")).toHaveScreenshot("detail-panel.png")
})
