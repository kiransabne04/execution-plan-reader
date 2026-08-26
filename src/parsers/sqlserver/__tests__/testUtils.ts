import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sqlserver",
)

export function loadFixture(filename: string): string {
  return readFileSync(path.join(FIXTURES_DIR, filename), "utf-8")
}
