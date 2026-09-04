// Story 6.3's own rapid-toggling edge case: several panel open/close
// actions in quick succession must never leave the DOM in a stale
// intermediate state — the final state must match the LAST action taken,
// not something in between (a real risk with several independent
// fixed/hidden-toggling surfaces — the icon rail's panel, the findings
// drawer, the detail overlay — all reacting to fast clicks).

import { test, expect } from "@playwright/test"
import { loadFixture, openPlanNode } from "./testUtils.js"

const ANALYZE_BUTTON = /analyze plan/i

test.describe("rapid toggling", () => {
  test("rapidly switching icon-rail panels ends on the last one clicked", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    // New plan -> Recent plans -> New plan -> Recent plans, fired without
    // waiting between clicks.
    await page.getByTestId("icon-rail-new-plan").click()
    await page.getByTestId("icon-rail-recent-plans").click()
    await page.getByTestId("icon-rail-new-plan").click()
    await page.getByTestId("icon-rail-recent-plans").click()

    await expect(page.getByTestId("icon-rail-recent-plans")).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByTestId("icon-rail-new-plan")).toHaveAttribute("aria-pressed", "false")
    // Exactly one panel wrapper in the DOM, showing Recent Plans' content.
    await expect(page.getByTestId("icon-rail-panel")).toBeVisible()
  })

  test("rapidly opening and closing the New Plan panel ends closed after an even number of clicks", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    for (let i = 0; i < 4; i++) {
      await page.getByTestId("icon-rail-new-plan").click()
    }
    await expect(page.getByTestId("icon-rail-panel")).not.toBeVisible()
  })

  test("rapidly re-clicking the same node keeps exactly one detail panel, no duplication", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    // Episode 26, Story 26.1 — canvas is the only rendering path now; the
    // accessible list (Story 15.2) is this test's deterministic,
    // repeatedly-clickable stand-in for "the same node."
    await page.getByTestId("accessible-list-toggle").click()
    const row = page.getByTestId("accessible-plan-list-item").first()
    // Re-clicking the same, already-selected node toggles its panel
    // closed (existing PlanGraph behavior, unchanged by this story) —
    // `force: true` bypasses the panel's own scrim, which would otherwise
    // block a second click on the row underneath it. The point of this
    // test is never seeing MORE than one panel accumulate, regardless of
    // which open/closed state a given click count lands on.
    for (let i = 0; i < 5; i++) {
      await row.click({ force: true })
      const count = await page.getByTestId("detail-panel").count()
      expect(count).toBeLessThanOrEqual(1)
    }
  })

  test("rapid click → close → click a different node → close ends with no panel and no accumulated scrims", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    await page.getByTestId("accessible-list-toggle").click()
    const rows = page.getByTestId("accessible-plan-list-item")
    const count = await rows.count()
    expect(count).toBeGreaterThan(1)

    // By design, an open un-pinned panel's scrim covers the whole canvas
    // (a deliberate modal-style choice — see planReaderPage.css's own
    // detail-scrim comment) — a different node has to be reached by
    // closing first, not by clicking straight through. Confirms that
    // rapid close→reopen→close cycles across different nodes never leave
    // more than one panel or scrim behind.
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click()
      await expect(page.getByTestId("detail-panel")).toHaveCount(1)
      await page.getByTestId("plan-shell-detail-scrim").click({ position: { x: 5, y: 5 } })
      await expect(page.getByTestId("detail-panel")).toHaveCount(0)
    }
    await expect(page.getByTestId("plan-shell-detail-scrim")).toHaveCount(0)
  })

  test("rapidly toggling the findings drawer open/closed ends in the correct final state, with valid final DOM either way", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "rule-wal-volume.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()

    for (let i = 0; i < 5; i++) {
      await page.getByTestId("findings-drawer-summary").click()
    }
    // Odd number of clicks from a closed start -> ends open.
    await expect(page.getByTestId("findings-drawer")).toHaveClass(/findings-drawer--open/)
    await expect(page.getByTestId("findings-drawer-body")).toBeVisible()
    // No duplicate/orphaned drawer bodies left behind from the rapid toggling.
    await expect(page.getByTestId("findings-drawer-body")).toHaveCount(1)
  })

  test("rapidly pinning/unpinning the detail panel ends in a consistent, non-corrupted state", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto("/")
    await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "simple-seq-scan.json"))
    await page.getByRole("button", { name: ANALYZE_BUTTON }).click()
    await openPlanNode(page)

    for (let i = 0; i < 3; i++) {
      await page.getByTestId("detail-panel-pin").click()
    }
    // Odd number of clicks from unpinned -> ends pinned.
    await expect(page.getByTestId("detail-panel")).toHaveClass(/detail-panel--in-shell/)
    await expect(page.getByTestId("detail-panel")).toHaveCount(1) // never duplicated across the toggle
  })
})
