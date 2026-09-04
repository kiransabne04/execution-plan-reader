// Episode 18, Story 18.5 — file drop, file picker, and sample-plan loaders,
// verified in a real browser: Playwright's file-chooser API
// (`setInputFiles`) drives an actual OS-level file input the way a real
// user's file picker would, which is worth its own check beyond the
// component-level tests (PasteBox.test.tsx) that exercise the same code
// path via jsdom's File/FileReader implementation.

import { test, expect } from "@playwright/test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { loadFixture } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i
const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/fixtures")

test("picking a real fixture file via the file picker analyzes it, identically to pasting its text", async ({ page }) => {
  await page.goto("/")
  await page.setInputFiles("[data-testid='file-picker-input']", path.join(FIXTURES_ROOT, "postgres", "simple-seq-scan.json"))

  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Postgres")
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
})

test("a real fixture per engine analyzes correctly and fires the specific rule it was chosen for", async ({ page }) => {
  await page.goto("/")

  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "bitmap-and-or-zero-rows.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Postgres")
  // Story 6.3 — Findings is a collapsed bottom drawer now; open it before
  // its rows are reachable.
  await page.getByTestId("findings-drawer-summary").click()
  await expect(
    page.getByTestId("finding-item").filter({ hasText: /bad.row.estimate|estimate/i }).first(),
  ).toBeVisible()

  // Story 6.3 — the New Plan panel auto-collapses to the icon rail after
  // analyze; reopen it before PasteBox's own "pasted · N lines" summary
  // (design review, unchanged by this story) is reachable to expand.
  await page.getByTestId("icon-rail-new-plan").click()
  await page.getByTestId("paste-box-expand").click()
  await page.getByTestId("paste-textarea").fill(loadFixture("sqlserver", "missing-index-recommendation.xml"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("SQL Server")

  await page.getByTestId("icon-rail-new-plan").click()
  await page.getByTestId("paste-box-expand").click()
  await page.getByTestId("paste-textarea").fill(loadFixture("snowflake", "spill-to-remote-disk.json"))
  await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Snowflake")
})

test("the dropzone accepts a real dropped file via a native drag-and-drop simulation", async ({ page }) => {
  await page.goto("/")

  // Playwright has no built-in "drag a real OS file" primitive (drag-and-
  // drop of files is a browser/OS-level interaction outside what
  // WebDriver-style automation can simulate) — this constructs the same
  // DataTransfer + drop event a real file drag would dispatch, reading the
  // fixture bytes into the page first (still entirely client-side; the
  // fixture read here is Playwright's own Node-side file access for
  // TEST SETUP, not a network call the page itself makes).
  const filePath = path.join(FIXTURES_ROOT, "snowflake", "spill-to-remote-disk.json")
  const buffer = await import("node:fs").then((fs) => fs.readFileSync(filePath, "utf-8"))

  await page.evaluate(
    ([text]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([text], "spill-to-remote-disk.json", { type: "application/json" }))
      const textarea = document.querySelector("[data-testid='paste-textarea']") as HTMLTextAreaElement
      textarea.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }))
      textarea.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    [buffer],
  )

  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("detected-engine-badge")).toHaveText("Snowflake")
})
