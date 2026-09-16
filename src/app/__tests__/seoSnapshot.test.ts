// User-directed SEO follow-up: this app is a 100% client-rendered SPA, so
// index.html ships a static snapshot of the empty-state content directly
// inside `#root` (see index.html's own comment) rather than an empty div —
// otherwise any crawler that doesn't execute JS sees no real content at
// all. These are the regression guards for that:
// - index.html's own literal copy must still match `emptyStateCopy.ts`'s
//   constants exactly (the two can't literally share a value — HTML can't
//   import a TS module — so this is the drift check).
// - `#root` must never go back to being empty in the raw HTML.
// - `main.tsx` must still clear that snapshot out before mounting the
//   real app, or a JS-capable visitor would see both at once.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { EMPTY_STATE_HEADING, EMPTY_STATE_SUBHEADING } from "../emptyStateCopy"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const indexHtml = readFileSync(path.join(REPO_ROOT, "index.html"), "utf-8")
const mainTsx = readFileSync(path.join(REPO_ROOT, "src/main.tsx"), "utf-8")

describe("index.html's static SEO snapshot", () => {
  it("has a real, non-empty #root in the raw HTML — not just an empty mount div", () => {
    const rootMatch = indexHtml.match(/<div id="root">([\s\S]*?)<\/div>\s*(?:<noscript|<script)/)
    expect(rootMatch).not.toBeNull()
    expect(rootMatch![1].trim().length).toBeGreaterThan(0)
  })

  it("contains the exact same heading text as the real React empty state (emptyStateCopy.ts)", () => {
    // index.html can't import the TS constant, so this is a literal-text
    // drift check: if emptyStateCopy.ts ever changes, this fails until
    // index.html's own copy is updated to match.
    expect(indexHtml).toContain(EMPTY_STATE_HEADING.replace("&", "&amp;"))
  })

  it("contains the exact same subheading text as the real React empty state", () => {
    expect(indexHtml.replace(/\s+/g, " ")).toContain(EMPTY_STATE_SUBHEADING.replace(/\s+/g, " "))
  })

  it("has a <noscript> fallback message for visitors without JavaScript", () => {
    expect(indexHtml).toContain("<noscript>")
    expect(indexHtml).toMatch(/needs JavaScript/i)
  })
})

describe("main.tsx clears the static snapshot before mounting the real app", () => {
  it("clears #root's children before calling createRoot(...).render(...)", () => {
    const clearIndex = mainTsx.search(/replaceChildren\(\)/)
    const renderIndex = mainTsx.search(/createRoot\(/)
    expect(clearIndex).toBeGreaterThan(-1)
    expect(renderIndex).toBeGreaterThan(-1)
    expect(clearIndex).toBeLessThan(renderIndex)
  })
})
