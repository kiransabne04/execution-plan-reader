// Episode 18, Story 18.12 — the true-mobile breakpoint (620px of the
// shell's own width, per spec §2b's breakpoint table): Findings leads by
// default, the detail panel becomes a bottom sheet, and every touch target
// is ≥44px. jsdom implements neither `@container` nor real layout, so
// this is verified in a real browser — see PlanReaderPage.tsx's own
// MOBILE_SHELL_BREAKPOINT_PX comment for the spec-internal 620/900/480
// discrepancy this resolves in favor of the breakpoint table.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ANALYZE_BUTTON = /analyze plan/i

test("Findings leads by default on true mobile — the result screen opens on Findings, not the graph", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "initplan-subplan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("shell-tab-findings")).toHaveAttribute("aria-selected", "true")
  await expect(page.getByTestId("findings-list")).toBeVisible()
  await expect(page.getByTestId("plan-node-card")).toHaveCount(0)

  // The graph is still reachable — switching tabs works normally.
  await page.getByTestId("shell-tab-graph").click()
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
})

test("a fresh analysis re-defaults to Findings even after switching to Graph on the previous plan", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("shell-tab-graph").click()
  await expect(page.getByTestId("shell-tab-graph")).toHaveAttribute("aria-selected", "true")

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("shell-tab-findings")).toHaveAttribute("aria-selected", "true")
})

test("the detail panel is a real bottom sheet on true mobile — anchored to the bottom, not sliding in from the side", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("shell-tab-graph").click()
  await page.getByTestId("plan-node-card").first().click()

  const panel = page.getByTestId("detail-panel")
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  // Anchored to the viewport's bottom edge (a real sheet), not a right-side
  // panel spanning the full height.
  expect(box!.y + box!.height).toBeGreaterThan(800)
  expect(box!.width).toBeGreaterThan(300) // full-width, not a narrow side rail
})

test("every tab control and the sheet's close button meet the 44px touch-target floor", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  for (const testId of ["shell-tab-findings", "shell-tab-graph"]) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  await page.getByTestId("shell-tab-graph").click()
  await page.getByTestId("plan-node-card").first().click()
  const closeButton = page.getByRole("button", { name: "Close details" })
  const closeBox = await closeButton.boundingBox()
  expect(closeBox).not.toBeNull()
  expect(closeBox!.width).toBeGreaterThanOrEqual(44)
  expect(closeBox!.height).toBeGreaterThanOrEqual(44)
})

test("app-bar buttons (Beginner/Expert, Walk me through it, Export) meet the 44px touch-target floor", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  for (const testId of ["shell-mode-beginner", "shell-mode-expert", "walkthrough-open", "export-png-button"]) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})

test("statement tabs meet the 44px touch-target floor and compose visually distinctly from the Findings/Graph tabs", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "multi-statement-batch.xml"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  const statementTabs = page.getByRole("tab", { name: /SELECT/ })
  await expect(statementTabs.first()).toBeVisible()
  const box = await statementTabs.first().boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // Two independent tab layers on one screen (statement tabs vs. Findings/
  // Graph tabs, this story's own edge case) — confirm both are reachable
  // and don't collide into one row.
  await expect(page.getByTestId("shell-tab-findings")).toBeVisible()
  const statementBox = (await statementTabs.first().boundingBox())!
  const shellTabBox = (await page.getByTestId("shell-tab-findings").boundingBox())!
  expect(statementBox.y).not.toBe(shellTabBox.y) // different rows, not overlapping
})

test("state survives an orientation change — active tab and open detail panel are preserved", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("shell-tab-graph").click()
  await page.getByTestId("plan-node-card").first().click()
  await expect(page.getByTestId("detail-panel")).toBeVisible()

  await page.setViewportSize({ width: 844, height: 390 }) // portrait -> landscape

  await expect(page.getByTestId("shell-tab-graph")).toHaveAttribute("aria-selected", "true")
  await expect(page.getByTestId("detail-panel")).toBeVisible()
})
