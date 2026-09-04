// Episode 18, Story 18.12 — the true-mobile breakpoint (620px of the
// shell's own width, per spec §2b's breakpoint table): the detail panel
// becomes a bottom sheet, and every touch target is ≥44px. jsdom implements
// neither `@container` nor real layout, so this is verified in a real
// browser — see PlanReaderPage.tsx's own MOBILE_SHELL_BREAKPOINT_PX comment
// for the spec-internal 620/900/480 discrepancy this resolves in favor of
// the breakpoint table.
//
// Story 6.3 — RETIRES the "Findings leads via a tab switch" mechanism this
// file originally verified (`shell-tab-findings`/`shell-tab-graph`):
// Findings moved from a competing side rail into a bottom drawer INSIDE the
// canvas, so there's no longer a separate "Findings" screen to default
// into. Spec §5 `1k`'s own "Findings leads, not the graph" intent is
// preserved through the SAME drawer defaulting to OPEN on true mobile
// instead (PlanReaderPage.tsx's own layout effect) — the graph is never
// hidden entirely, an improvement over the old either/or tab switch.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ANALYZE_BUTTON = /analyze plan/i

test("the findings drawer opens by default on true mobile — Findings leads, but the graph stays visible too", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "initplan-subplan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
  await expect(page.getByTestId("findings-drawer-body")).toBeVisible()
  // Unlike the old either/or tab switch, the graph is never hidden —
  // Findings "leads" by defaulting open, not by hiding the canvas.
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
})

test("a fresh analysis re-defaults the drawer to open even after the user collapsed it on the previous plan", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("findings-drawer-summary").click() // collapse it
  await expect(page.getByTestId("findings-drawer")).not.toHaveClass(/findings-drawer--open/)

  await page.getByTestId("icon-rail-new-plan").click()
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
})

test("the detail panel is a real bottom sheet on true mobile — anchored to the bottom, not sliding in from the side", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
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

test("the icon rail, findings drawer summary, and the sheet's close button meet the 44px touch-target floor", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

  for (const testId of ["icon-rail-new-plan", "icon-rail-recent-plans", "icon-rail-findings"]) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  const summaryBox = await page.getByTestId("findings-drawer-summary").boundingBox()
  expect(summaryBox).not.toBeNull()
  expect(summaryBox!.height).toBeGreaterThanOrEqual(44)

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

test("statement tabs meet the 44px touch-target floor and compose visually distinctly from the findings drawer", async ({
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

  // Two independent layers on one screen (statement tabs at the top,
  // the findings drawer docked at the bottom) — confirm both are
  // reachable and don't collide into one row.
  await expect(page.getByTestId("findings-drawer-summary")).toBeVisible()
  const statementBox = (await statementTabs.first().boundingBox())!
  const drawerBox = (await page.getByTestId("findings-drawer-summary").boundingBox())!
  expect(statementBox.y).not.toBe(drawerBox.y) // different rows, not overlapping
})

test("state survives an orientation change — the open detail panel is preserved", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await page.getByTestId("plan-node-card").first().click()
  await expect(page.getByTestId("detail-panel")).toBeVisible()

  await page.setViewportSize({ width: 844, height: 390 }) // portrait -> landscape

  await expect(page.getByTestId("detail-panel")).toBeVisible()
})
