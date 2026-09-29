import { test, expect } from "@playwright/test"

// Episode SEO-03, Story 03.3. See postgres-landing-page.spec.ts's own
// header comment for why this hits the `.html` filename directly in local
// dev rather than the clean production URL (a Vercel `cleanUrls: true`
// behavior, not a local dev-server one).

test("Snowflake landing page has the real title, canonical, meta description, and JSON-LD", async ({ page }) => {
  await page.goto("/snowflake-query-profile-analyzer.html")
  await expect(page).toHaveTitle("Snowflake Query Profile Analyzer | PlanReader")

  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute("href", "https://www.planreader.dev/snowflake-query-profile-analyzer")

  const description = page.locator('meta[name="description"]')
  await expect(description).toHaveAttribute("content", /GET_QUERY_OPERATOR_STATS/)

  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent()
  const parsed = JSON.parse(jsonLd ?? "{}")
  expect(parsed["@type"]).toBe("WebPage")
  expect(parsed.url).toBe("https://www.planreader.dev/snowflake-query-profile-analyzer")
})

test("Analyzer CTA navigates to the real app; Try-sample link lands on the real sample-plans anchor; no Query Context content anywhere", async ({
  page,
}) => {
  await page.goto("/snowflake-query-profile-analyzer.html")

  await page.getByRole("heading", { level: 1, name: "Snowflake Query Profile Analyzer" }).waitFor()

  const bodyText = await page.locator("body").innerText()
  for (const term of ["Query Context", "QUERY_HISTORY", "warehouse queuing", "QAS"]) {
    expect(bodyText).not.toContain(term)
  }

  await page.getByRole("link", { name: "Analyze your plan free" }).click()
  await expect(page).toHaveURL("/")
  await expect(page.getByTestId("paste-textarea")).toBeVisible()

  await page.goto("/snowflake-query-profile-analyzer.html")
  await page.getByRole("link", { name: "Try a sample Snowflake plan" }).click()
  await expect(page).toHaveURL(/\/#sample-plans$/)
  await expect(page.getByTestId("sample-plan-list")).toBeInViewport()
})
