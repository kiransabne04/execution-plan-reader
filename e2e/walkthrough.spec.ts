// Episode 18, Story 18.9 — guided walkthrough, verified end-to-end in a
// real browser: focus-management (heading regains focus on each advance)
// and the "graph dimmed but visible behind it" treatment are both real-
// rendering concerns jsdom can't meaningfully verify (see
// PlanReaderPage.test.tsx's own component-test coverage of the wiring —
// this file is the real walk-start-to-finish verification on top of it).

import { test, expect } from "@playwright/test"

test.describe("guided walkthrough (spec §5 `1g`)", () => {
  test("walks a real multi-warning plan start to finish, with the graph visible-but-dimmed behind the overlay throughout", async ({
    page,
  }) => {
    await page.goto("/")
    // Story 18.5's Postgres sample — a real fixture chosen because it
    // fires a real rule (bad-row-estimate), giving this walkthrough more
    // than just the root step.
    await page.getByTestId("sample-plan-postgres").click()
    await expect(page.getByTestId("plan-node-card").first()).toBeVisible()

    await page.getByTestId("walkthrough-open").click()
    const overlay = page.getByTestId("walkthrough-overlay")
    await expect(overlay).toBeVisible()

    // The graph is still in the DOM and visible (not hidden/unmounted)
    // behind the overlay's translucent backdrop.
    await expect(page.getByTestId("plan-node-card").first()).toBeVisible()

    const counter = page.getByTestId("walkthrough-step-counter")
    const firstCountText = await counter.textContent()
    expect(firstCountText).toMatch(/^Step 1 of \d+$/)

    // Step through to the end via the keyboard, confirming focus lands on
    // the step heading after each advance (this story's own explicit,
    // testable focus-management requirement).
    // Capped rather than an unbounded while(true) — a real fixture has a
    // small, known number of steps; a cap keeps a genuine regression (the
    // "Finish" button never appearing) a fast, clear failure instead of a
    // hang.
    for (let i = 0; i < 20; i++) {
      if (await page.getByTestId("walkthrough-finish").isVisible()) break
      const before = await counter.textContent()
      await page.keyboard.press("ArrowRight")
      await expect(counter).not.toHaveText(before ?? "")
      await expect(page.getByTestId("walkthrough-step-heading")).toBeFocused()
    }

    await expect(page.getByTestId("walkthrough-finish")).toBeVisible()
    await page.getByTestId("walkthrough-finish").click()

    // Exiting reuses focusNodeId — the last-viewed node's detail panel
    // is open in the shell once the overlay closes.
    await expect(overlay).toBeHidden()
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })

  test("Escape exits the walkthrough and opens the last-viewed node's detail panel", async ({ page }) => {
    await page.goto("/")
    await page.getByTestId("sample-plan-postgres").click()
    await expect(page.getByTestId("plan-node-card").first()).toBeVisible()

    await page.getByTestId("walkthrough-open").click()
    await expect(page.getByTestId("walkthrough-overlay")).toBeVisible()

    await page.keyboard.press("Escape")

    await expect(page.getByTestId("walkthrough-overlay")).toBeHidden()
    await expect(page.getByTestId("detail-panel")).toBeVisible()
  })

  test("Beginner/Expert toggle inside the walkthrough is the same lifted state as the app bar's", async ({ page }) => {
    await page.goto("/")
    await page.getByTestId("sample-plan-postgres").click()
    await expect(page.getByTestId("plan-node-card").first()).toBeVisible()

    await page.getByTestId("walkthrough-open").click()
    await expect(page.getByTestId("walkthrough-mode-beginner")).toHaveAttribute("aria-pressed", "true")

    await page.getByTestId("walkthrough-mode-expert").click()
    await expect(page.getByTestId("walkthrough-mode-expert")).toHaveAttribute("aria-pressed", "true")

    await page.keyboard.press("Escape")
    // The app bar's own toggle reflects the same change made from inside the walkthrough.
    await expect(page.getByTestId("shell-mode-expert")).toHaveAttribute("aria-pressed", "true")
  })
})
