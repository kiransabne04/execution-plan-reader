// Episode 6, Story 6.1 edge case: "the product must be usable from a phone
// (per positioning brief mobile-usability requirement) — test dagre layout
// and pan/zoom interaction specifically at mobile widths, not just desktop."
// Not automatable at the "does this feel good to use" level, but the
// concrete, checkable claims are: the paste box and graph both render
// usably at a real phone width, and nothing forces horizontal page scroll.

import { test, expect } from "@playwright/test"
import { loadFixture, openPlanNode } from "./testUtils.js"

// A plain viewport override (not the full `devices["iPhone 13"]` preset,
// which also forces the WebKit engine) — this project only exercises
// chromium; the goal here is testing responsive CSS/layout at a real phone
// width, not WebKit-specific rendering behavior.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("paste box is usable at a mobile viewport width", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("paste-textarea")).toBeVisible()
  await expect(page.getByRole("button", { name: /analyze plan/i })).toBeVisible()

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasHorizontalOverflow).toBe(false)
})

test("the graph renders visibly and without horizontal page overflow at a mobile viewport width", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
  await page.getByRole("button", { name: /analyze plan/i }).click()

  // Story 6.3 — the graph is always visible now (the retired narrow-shell
  // tab switch used to gate it behind a "Graph" tab); Findings leads on
  // true mobile (spec §5 `1k`) through the findings drawer defaulting to
  // open instead — see mobile-breakpoints.spec.ts.
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasHorizontalOverflow).toBe(false)
})

test("a node's detail panel is still usable (visible, closable) at a mobile viewport width", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
  await page.getByRole("button", { name: /analyze plan/i }).click()
  // Story 6.3 — the graph is always visible now, no tab switch needed.
  await openPlanNode(page)

  await expect(page.getByTestId("detail-panel")).toBeVisible()
  await page.getByRole("button", { name: "Close details" }).click()
  await expect(page.getByTestId("detail-panel")).toBeHidden()
})
