import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/postgres",
)

/**
 * Reads a Postgres fixture as raw text — never via a JS `import ... from
 * '*.json'`, which would go through the bundler's own JSON.parse and
 * silently defeat the duplicate-key fixtures this parser exists to handle.
 */
export function loadFixture(filename: string): string {
  return readFileSync(path.join(FIXTURES_DIR, filename), "utf-8")
}
