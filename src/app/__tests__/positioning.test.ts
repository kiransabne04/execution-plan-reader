// Episode 8, Story 8.1 acceptance criteria: "Meta title/description and
// schema.org SoftwareApplication markup match the positioning brief
// exactly." Reads index.html directly rather than mounting anything, since
// this is checking a static document, not a React component — and it's a
// real regression guard against the exact copy ever silently drifting from
// docs/05-landing-page-positioning.md.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { HERO_HEADLINE, HERO_SUBHEADLINE, SUPPORTED_ENGINES } from "../positioningCopy"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const indexHtml = readFileSync(path.join(REPO_ROOT, "index.html"), "utf-8")

function extractJsonLd(html: string): Record<string, unknown> {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error("No JSON-LD script block found in index.html")
  return JSON.parse(match[1])
}

describe("Episode 8 positioning: index.html matches the brief exactly", () => {
  it("has the exact recommended meta title", () => {
    expect(indexHtml).toContain("<title>PlanReader — Explain Any Database Execution Plan in Plain English</title>")
  })

  it("has the exact recommended meta description", () => {
    expect(indexHtml).toContain(
      'content="Paste a raw Postgres, SQL Server, or Snowflake execution plan and get a free, plain-English explanation plus a visual node-graph — no signup, nothing stored."',
    )
  })

  it("has schema.org SoftwareApplication structured data matching the brief exactly", () => {
    const schema = extractJsonLd(indexHtml)
    expect(schema).toEqual({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "PlanReader",
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Database Performance Tool",
      operatingSystem: "Any (web-based)",
      url: "https://planreader.dev",
      description:
        "A free, no-signup web tool that explains raw database execution plans (Postgres, SQL Server, Snowflake) in plain English, with an interactive node-graph visualization of the plan tree.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Plain-English explanation of execution plans",
        "Interactive node-graph visualization",
        "Support for Postgres, SQL Server, and Snowflake",
        "No signup required",
        "Client-side, privacy-preserving parsing",
      ],
      creator: { "@type": "Person", name: "Kiran Sabne" },
    })
  })
})

describe("Episode 8 positioning: hero copy matches the brief exactly", () => {
  it("has the exact recommended hero headline, and it contains 'execution plan'", () => {
    expect(HERO_HEADLINE).toBe("Paste your database execution plan. Get a plain-English explanation.")
    expect(HERO_HEADLINE).toContain("execution plan")
  })

  it("has the exact recommended subheadline", () => {
    expect(HERO_SUBHEADLINE).toBe(
      "Free, no signup. Works with Postgres, SQL Server, and Snowflake — paste your plan, see a visual breakdown of what's slow and why.",
    )
  })

  it("names all three supported engines", () => {
    expect(SUPPORTED_ENGINES).toEqual(["Postgres", "SQL Server", "Snowflake"])
  })
})
