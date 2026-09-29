import { test, expect } from "@playwright/test"

// Episode SEO-03, Story 03.2. See postgres-landing-page.spec.ts's own
// header comment for why this hits the `.html` filename directly in local
// dev rather than the clean production URL (a Vercel `cleanUrls: true`
// behavior, not a local dev-server one).

test("SQL Server landing page has the real title, canonical, meta description, and JSON-LD", async ({ page }) => {
  await page.goto("/sql-server-execution-plan-analyzer.html")
  await expect(page).toHaveTitle("SQL Server Execution Plan Analyzer & Showplan Viewer | PlanReader")

  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute("href", "https://www.planreader.dev/sql-server-execution-plan-analyzer")

  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute("content", /Showplan XML/)

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
  const parsed = JSON.parse(jsonLd ?? "{}")
  expect(parsed["@type"]).toBe("WebPage")
  expect(parsed.url).toBe("https://www.planreader.dev/sql-server-execution-plan-analyzer")
})

test("Analyzer CTA navigates to the real app; Try-sample link lands on the real sample-plans anchor", async ({ page }) => {
  await page.goto("/sql-server-execution-plan-analyzer.html")

  await page.getByRole("heading", { level: 1, name: "SQL Server Execution Plan Analyzer" }).waitFor()

  await page.getByRole("link", { name: "Analyze your plan free" }).click()
  await expect(page).toHaveURL("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  await page.goto("/sql-server-execution-plan-analyzer.html")
  await page.getByRole("link", { name: "Try a sample SQL Server plan" }).click()
  await expect(page).toHaveURL(/\/#sample-plans$/)
  await expect(page.getByTestId("sample-plan-list")).toBeInViewport()
})
