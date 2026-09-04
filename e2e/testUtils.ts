import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function loadFixture(engine: string, filename: string): string {
  return readFileSync(path.resolve(HERE, `../src/fixtures/${engine}/${filename}`), "utf-8")
}
