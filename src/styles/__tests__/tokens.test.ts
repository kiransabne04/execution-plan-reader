// Episode 18, Story 18.1's own testing approach: a grep-style structural
// check that the token consolidation actually stuck — no component CSS
// file redeclares a --pr-*/--pg-*/--dp-*/--fl-* token (only tokens.css may
// declare them), and no `prefers-color-scheme` media query survives
// anywhere under src/ (this app is dark-only, not dark-first).

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const TOKENS_FILE = path.resolve(SRC_DIR, "styles/tokens.css")

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith(".css") ? [full] : []
  })
}

// A DECLARATION line defines the token itself ("--pr-bg: #161826;") — a
// USAGE line just reads it ("background: var(--pr-bg);"). Only the former
// is what this story requires living in exactly one place; the latter is
// exactly what's supposed to stay unchanged in every other file.
const DECLARATION_PATTERN = /^\s*--(pr|pg|dp|fl)-[a-z0-9-]+\s*:/i
const PREFERS_COLOR_SCHEME_MEDIA_PATTERN = /@media[^{]*prefers-color-scheme/i

describe("Episode 18 Story 18.1 — consolidated design tokens", () => {
  const cssFiles = walk(SRC_DIR)

  it("finds more than one CSS file, so this test isn't silently vacuous", () => {
    expect(cssFiles.length).toBeGreaterThan(5)
  })

  it("declares every --pr-*/--pg-*/--dp-*/--fl-* token exactly once, in tokens.css, nowhere else", () => {
    const declarationsOutsideTokensCss: string[] = []
    for (const file of cssFiles) {
      if (file === TOKENS_FILE) continue
      const lines = readFileSync(file, "utf-8").split("\n")
      for (const [i, line] of lines.entries()) {
        if (DECLARATION_PATTERN.test(line)) {
          declarationsOutsideTokensCss.push(`${path.relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(declarationsOutsideTokensCss).toEqual([])
  })

  it("has no `prefers-color-scheme` media query anywhere under src/ — dark-only, not dark-first", () => {
    const offenders: string[] = []
    for (const file of cssFiles) {
      const lines = readFileSync(file, "utf-8").split("\n")
      for (const [i, line] of lines.entries()) {
        if (PREFERS_COLOR_SCHEME_MEDIA_PATTERN.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("tokens.css declares every legacy token name at least once", () => {
    const content = readFileSync(TOKENS_FILE, "utf-8")
    const legacyNames = ["--pr-bg", "--pr-accent", "--pg-card-bg", "--pg-comparison-changed", "--dp-bg", "--dp-callout-text", "--fl-critical-bg", "--fl-info-text"]
    for (const name of legacyNames) {
      expect(content, `expected tokens.css to declare ${name}`).toContain(`${name}:`)
    }
  })

  it("declares color-scheme: dark and no light-mode color-scheme value", () => {
    const content = readFileSync(TOKENS_FILE, "utf-8")
    expect(content).toContain("color-scheme: dark")
    expect(content).not.toMatch(/color-scheme:\s*light/)
  })
})
