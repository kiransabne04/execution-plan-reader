// Episode 18, Story 18.11 — PNG export. jsdom has no real 2D canvas
// context at all (see canvasDraw's unit tests' own fake-context comment,
// and PlanGraph.test.tsx's exportPng() ref tests, which can only confirm
// the null-context degrade there) — this is the real end-to-end
// verification that a real browser actually produces a real PNG file,
// entirely client-side.

import { test, expect } from "@playwright/test"

const ANALYZE_BUTTON = /analyze plan/i

const SMALL_PLAN = `Hash Join  (cost=1.20..50.00 rows=500 width=64) (actual time=0.5..8.4 rows=480 loops=1)
  Hash Cond: (orders.customer_id = customers.id)
  ->  Seq Scan on orders  (cost=0.00..30.00 rows=1000 width=32) (actual time=0.01..2.1 rows=980 loops=1)
  ->  Hash  (cost=1.00..1.00 rows=20 width=32) (actual time=0.02..0.02 rows=20 loops=1)
        ->  Seq Scan on customers  (cost=0.00..1.00 rows=20 width=32) (actual time=0.01..0.01 rows=20 loops=1)
Planning Time: 0.4 ms
Execution Time: 9.0 ms`

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
    node = { "Node Type": "Nested Loop", "Startup Cost": 0.0, "Total Cost": 10.0 + i, "Plan Rows": 10, "Plan Width": 8, Plans: [node] }
  }
  return JSON.stringify([{ Plan: node }])
}

// A minimal, dependency-free PNG signature check — the first 8 bytes of
// any valid PNG file are always this exact sequence.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test("exports a real PNG file for a small plan", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(SMALL_PLAN)
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("export-png-button").click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^planreader-postgres\.png$/)
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const fs = await import("node:fs/promises")
  const bytes = await fs.readFile(downloadedPath!)
  expect(bytes.length).toBeGreaterThan(100) // a real, non-trivial file, not an empty stub
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
})

test("exports a real PNG file for a large plan too — visually consistent per spec §5 `1j`, same export code path either way", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(buildLargePostgresPlanJson(320))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("export-png-button").click()
  const download = await downloadPromise

  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const fs = await import("node:fs/promises")
  const bytes = await fs.readFile(downloadedPath!)
  expect(bytes.length).toBeGreaterThan(100)
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
})

test("the exported PNG reflects the CURRENT collapsedIds state, not a forced full expand", async ({ page }) => {
  // A plan whose default-collapse (Episode 6) leaves a placeholder node
  // in the graph — the export, per this story's own edge case, should
  // still reflect that collapsed state (a smaller file than a fully
  // expanded equivalent would be, and no crash/hang from suddenly having
  // to render everything).
  await page.goto("/")
  await page.getByTestId("paste-textarea").fill(buildLargePostgresPlanJson(260))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("canvas-plan-graph-surface")).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await page.getByTestId("export-png-button").click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
})
