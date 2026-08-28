// Episode 15 — a real-browser check that the canvas rendering path
// actually works, not just that it doesn't throw in jsdom (which has no
// real 2d canvas context at all — see CanvasPlanGraph.tsx's own
// getContext-returns-null guard and the unit tests built around it). No
// fixture in this repo is anywhere near CANVAS_NODE_COUNT_THRESHOLD, so
// this generates a large synthetic (but well-formed) Postgres JSON plan —
// a long single-child chain is enough to push the node count over the
// threshold without needing a realistic query shape.

import { test, expect } from "@playwright/test"

function buildLargePostgresPlanJson(chainLength: number): string {
  let node: Record<string, unknown> = {
    "Node Type": "Seq Scan",
    "Relation Name": "leaf_table",
    "Startup Cost": 0.0,
    "Total Cost": 1.0,
    "Plan Rows": 1,
    "Plan Width": 8,
  }
  for (let i = 0; i < chainLength; i++) {
    node = {
      "Node Type": "Nested Loop",
      "Startup Cost": 0.0,
      "Total Cost": 10.0 + i,
      "Plan Rows": 10,
      "Plan Width": 8,
      Plans: [node],
    }
  }
  return JSON.stringify([{ Plan: node }])
}

test("a plan large enough to cross the canvas threshold renders via the canvas path, with a working accessible-list fallback", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(buildLargePostgresPlanJson(320))
  await page.getByRole("button", { name: /analyze plan/i }).click()

  const canvas = page.getByTestId("canvas-plan-graph-surface")
  await expect(canvas).toBeVisible()
  // Never the DOM/SVG path's per-node cards at this size.
  await expect(page.getByTestId("plan-node-card")).toHaveCount(0)

  // The canvas actually drew something — not a blank surface. Sampling a
  // handful of pixels across the canvas and confirming at least one is
  // non-transparent is a coarse but real signal getContext('2d') worked
  // and drawGraph ran, which no jsdom-based unit test can prove.
  const hasVisibleContent = await canvas.evaluate((el) => {
    const canvasEl = el as HTMLCanvasElement
    const ctx = canvasEl.getContext("2d")
    if (!ctx) return false
    const { width, height } = canvasEl
    if (width === 0 || height === 0) return false
    const { data } = ctx.getImageData(0, 0, width, height)
    for (let i = 3; i < data.length; i += 4 * 97) {
      // sample every 97th pixel's alpha channel
      if (data[i] > 0) return true
    }
    return false
  })
  expect(hasVisibleContent).toBe(true)

  // The accessible-list toggle is always present and reachable — Story 15.2.
  const toggle = page.getByTestId("accessible-list-toggle")
  await expect(toggle).toBeVisible()
  await toggle.click()

  const list = page.getByTestId("accessible-plan-list")
  await expect(list).toBeVisible()
  const items = page.getByTestId("accessible-plan-list-item")
  await expect(items.first()).toBeVisible()
  const itemCount = await items.count()
  expect(itemCount).toBeGreaterThan(0)

  // Clicking a row opens the same real detail panel the DOM/SVG path uses.
  await items.first().click()
  await expect(page.getByTestId("detail-panel")).toBeVisible()
})
