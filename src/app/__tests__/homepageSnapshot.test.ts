// Episode SEO-02, Story 02.2: index.html ships a static, crawlable
// snapshot of the homepage content sections (`.seo-sections`, right after
// `.seo-snapshot`) for the same reason seoSnapshot.test.ts's own header
// comment gives — this is a 100% client-rendered SPA, so a crawler that
// doesn't execute JS would otherwise see none of this brand-new SEO
// content at all. index.html can't import homepageContent.ts (HTML can't
// import a TS module), so this is the literal-text drift check between
// the two, same pattern as seoSnapshot.test.ts.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  FAQ_ITEMS,
  HOW_IT_WORKS,
  PRIVACY_POINTS,
  SUPPORTED_DATABASES,
  WHAT_IT_DETECTS,
  WHY_PLANREADER,
} from "../homepageContent"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const indexHtml = readFileSync(path.join(REPO_ROOT, "index.html"), "utf-8")
const normalized = indexHtml.replace(/\s+/g, " ")

function expectContains(text: string) {
  expect(normalized).toContain(text.replace(/\s+/g, " "))
}

describe("index.html's static homepage-sections snapshot (.seo-sections)", () => {
  it("has a non-empty .seo-sections block in the raw HTML", () => {
    const match = indexHtml.match(/<div class="seo-sections">([\s\S]*?)<\/div>\s*<\/div>/)
    expect(match).not.toBeNull()
    expect(match![1].trim().length).toBeGreaterThan(0)
  })

  it("has all 8 section headings, in the story's own order", () => {
    const headings = [...indexHtml.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(headings).toEqual([
      "Supported Databases",
      "What PlanReader Detects",
      "Why PlanReader",
      "How It Works",
      "Privacy",
      "Try an Example",
      "Learn More",
      "FAQ",
    ])
  })

  it("names all 3 supported engines with their real accepted input format", () => {
    for (const db of SUPPORTED_DATABASES) {
      expectContains(`<a href="${db.href}">${db.engine}</a> — ${db.format}`)
    }
  })

  it("contains every 'what it detects' and 'why PlanReader' bullet", () => {
    for (const item of [...WHAT_IT_DETECTS, ...WHY_PLANREADER, ...PRIVACY_POINTS]) {
      expectContains(item)
    }
  })

  it("contains all 3 How It Works step titles and descriptions", () => {
    for (const step of HOW_IT_WORKS) {
      expectContains(step.title)
      expectContains(step.description)
    }
  })

  it("contains every FAQ question and answer, with no FAQPage JSON-LD (not requested by Story 02.3)", () => {
    for (const item of FAQ_ITEMS) {
      expectContains(item.question)
      expectContains(item.answer)
    }
    expect(indexHtml).not.toContain('"@type": "FAQPage"')
  })
})
