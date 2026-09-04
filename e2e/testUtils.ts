import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function loadFixture(engine: string, filename: string): string {
  return readFileSync(path.resolve(HERE, `../src/fixtures/${engine}/${filename}`), "utf-8")
}

/** Episode 26, Story 26.1 — canvas is now the only rendering path, so a
 * plan node is never a real DOM element a Playwright locator can target by
 * position the way a React Flow card used to be. The accessible list
 * (Story 15.2, now the universal keyboard/screen-reader path) is this
 * suite's deterministic way to open a specific node's detail panel — real
 * canvas hit-testing pixel math is exercised directly by
 * canvas-real-estate.spec.ts and CanvasPlanGraph's own unit tests, not
 * re-derived per e2e spec here. Opens the list if it isn't already open
 * (idempotent), clicks the row at `index`, and waits for its detail panel
 * to appear — deliberately leaves the accessible list showing afterward
 * rather than switching back to the canvas view: every real caller here
 * only asserts on the detail panel/shell chrome, never on canvas-specific
 * rendering, and an extra click to switch back is one more thing that can
 * race an open, un-pinned panel's own scrim for no actual benefit. */
export async function openPlanNode(page: Page, index = 0): Promise<void> {
  const list = page.getByTestId("accessible-plan-list")
  if (!(await list.isVisible().catch(() => false))) {
    await page.getByTestId("accessible-list-toggle").click()
  }
  await page.getByTestId("accessible-plan-list-item").nth(index).click()
  await page.getByTestId("detail-panel").first().waitFor({ state: "visible" })
}
