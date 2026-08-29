// Episode 14, Story 14.2 — the comparison view, driven end-to-end in a real
// browser. React Flow's actual DOM layout/pan (dagre positions, setCenter)
// isn't something jsdom can meaningfully verify, so — like the canvas path
// (canvas-large-plan.spec.ts) — the synced-selection behavior is checked
// here, not just at the component level (PlanComparisonView.test.tsx
// already covers the pure logic/state transitions with a synthetic tree).

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test("comparing two plans of the same engine shows the summary strip and two panes", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("plan-result")).toBeVisible()

  await page.getByTestId("compare-toggle").click()
  await page.getByTestId("compare-paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByTestId("compare-paste-submit").click()

  await expect(page.getByTestId("plan-comparison-view")).toBeVisible()
  await expect(page.getByTestId("comparison-summary")).toBeVisible()
  // Two independent PlanGraph panes, each with its own set of node cards.
  await expect(page.getByTestId("plan-graph")).toHaveCount(2)
})

test("clicking a matched node in one pane opens the counterpart's detail panel in the other", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("compare-toggle").click()
  // Comparing the plan against itself (a fresh "capture") is the
  // regression floor Story 14.1 itself requires — 100% matched, and here
  // that means every click has a guaranteed counterpart to sync to.
  await page.getByTestId("compare-paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByTestId("compare-paste-submit").click()
  await expect(page.getByTestId("plan-comparison-view")).toBeVisible()

  const panes = page.getByTestId("plan-graph")
  await panes.nth(0).getByTestId("plan-node-card").first().click()

  // Both panes now have an open detail panel — the second one opened via
  // the synced-selection path, not a second manual click.
  await expect(page.getByTestId("detail-panel")).toHaveCount(2)
  await expect(page.getByTestId("comparison-no-match-notice")).toHaveCount(0)
})

test("shows a clear cross-engine message instead of a broken comparison view", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("compare-toggle").click()
  await page.getByTestId("compare-paste-textarea").fill(loadFixture("sqlserver", "hash-join.xml"))
  await page.getByTestId("compare-paste-submit").click()

  await expect(page.getByTestId("plan-comparison-error")).toBeVisible()
  await expect(page.getByTestId("plan-comparison-error")).toContainText(/different database engines/)
  await expect(page.getByTestId("plan-comparison-view")).toHaveCount(0)
})

test("'Stop comparing' returns to the normal single-plan view", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("compare-toggle").click()
  await page.getByTestId("compare-paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByTestId("compare-paste-submit").click()
  await expect(page.getByTestId("plan-comparison-view")).toBeVisible()

  await page.getByTestId("stop-comparing").click()

  await expect(page.getByTestId("plan-comparison-view")).toHaveCount(0)
  await expect(page.getByTestId("plan-graph")).toHaveCount(1)
  await expect(page.getByTestId("compare-toggle")).toBeVisible()
})
