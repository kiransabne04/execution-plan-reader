import { test, expect } from "@playwright/test"

// Episode SEO-03, Story 03.1. Vite's dev server serves multi-page entries
// at their literal filename (`/postgresql-execution-plan-analyzer.html`) —
// the extensionless clean URL (`/postgresql-execution-plan-analyzer`) is a
// Vercel `cleanUrls: true` production behavior (vercel.json), not
// something the local dev server itself does, so this spec exercises the
// real built page via its filesystem path, same as every other Vite
// multi-page entry would be reached in local dev.

test("PostgreSQL landing page has the real title, canonical, meta description, and JSON-LD", async ({ page }) => {
  await page.goto("/postgresql-execution-plan-analyzer.html")
  await expect(page).toHaveTitle("PostgreSQL EXPLAIN ANALYZE Visualizer & Execution Plan Analyzer | PlanReader")

  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute("href", "https://www.planreader.dev/postgresql-execution-plan-analyzer")

  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute("content", /PostgreSQL EXPLAIN plan/)

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
  const parsed = JSON.parse(jsonLd ?? "{}")
  expect(parsed["@type"]).toBe("WebPage")
  expect(parsed.url).toBe("https://www.planreader.dev/postgresql-execution-plan-analyzer")
})

test("Analyzer CTA navigates to the real app; Try-sample link lands on the real sample-plans anchor", async ({ page }) => {
  await page.goto("/postgresql-execution-plan-analyzer.html")

  await page.getByRole("heading", { level: 1, name: "PostgreSQL Execution Plan Analyzer" }).waitFor()

  await page.getByRole("link", { name: "Analyze your plan free" }).click()
  await expect(page).toHaveURL("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  await page.goto("/postgresql-execution-plan-analyzer.html")
  await page.getByRole("link", { name: "Try a sample Postgres plan" }).click()
  await expect(page).toHaveURL(/\/#sample-plans$/)
  await expect(page.getByTestId("sample-plan-list")).toBeInViewport()
})
