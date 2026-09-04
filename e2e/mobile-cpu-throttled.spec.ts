// Episode 16, Story 16.2 — "mobile-specific responsiveness is tested
// separately from desktop, not assumed to follow from desktop performance
// — test against a deliberately modest device/throttled CPU profile, not
// just the developer's own machine." mobile-viewport.spec.ts (Episode 6)
// already checks layout/overflow at a real phone width; this extends that
// with an actual CPU throttle via the Chrome DevTools Protocol, which
// viewport emulation alone doesn't give — a modern desktop CPU emulating a
// narrow viewport is still a modern desktop CPU.

import { test, expect } from "@playwright/test"
import { loadFixture } from "./testUtils.js"

// 4x is the commonly used "mid-tier mobile" throttle factor (roughly what
// Lighthouse's mobile preset applies) — deliberately modest, not a
// worst-case low-end device, per the story's own "mid-range mobile device"
// framing.
const CPU_THROTTLE_RATE = 4

test("the core paste -> analyze -> open detail panel flow stays usable on a throttled-CPU mobile viewport", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE })

  await page.goto(baseURL ?? "/")
  await page.getByTestId("paste-textarea").fill(loadFixture("postgres", "multi-way-join.json"))

  const start = Date.now()
  await page.getByRole("button", { name: /analyze plan/i }).click()
  // Story 6.3 — the graph is always visible now (the retired narrow-shell
  // tab switch used to require an explicit tab click here).
  await expect(page.getByTestId("plan-node-card").first()).toBeVisible()
  const analyzeElapsed = Date.now() - start
  // Generous — this is a throttled CPU on a small, real fixture, not a
  // tight budget; exists to catch a genuine "the page hangs" regression.
  expect(analyzeElapsed).toBeLessThan(5000)

  await page.getByTestId("plan-node-card").first().click()
  await expect(page.getByTestId("detail-panel")).toBeVisible()

  await context.close()
})

test("page load itself stays responsive on a throttled-CPU mobile viewport", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE })

  const start = Date.now()
  await page.goto(baseURL ?? "/")
  // Episode 19: the hero h1 this test used to wait on is retired — the
  // shell (and Plan Input inside it) is the first thing on the page now.
  await expect(page.getByTestId("plan-result")).toBeVisible()
  await expect(page.getByTestId("paste-textarea")).toBeVisible()
  const loadElapsed = Date.now() - start
  expect(loadElapsed).toBeLessThan(5000)

  await context.close()
})
