// Episode 7 edge case: "Parse errors that include the raw offending input
// in their message" are a classic accidental leak vector (error logging/
// telemetry could exfiltrate plan content even in an otherwise privacy-safe
// tool). This sweeps every fixture across all three engines generically —
// whichever ones happen to throw a PlanParseError, positive or future —
// rather than hardcoding a list of "the invalid ones," so a new invalid
// fixture added later is covered automatically.

import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { PlanParseError } from "../../parsers/normalize"
import { parsePostgresJsonPlan } from "../../parsers/postgres/parseJsonPlan"
import { parsePostgresTextPlan } from "../../parsers/postgres/textParser"
import { parseSqlServerShowplanXml } from "../../parsers/sqlserver/parseShowplanXml"
import { parseSnowflakeOperatorStats } from "../../parsers/snowflake"

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures")

function readFixtureDir(engine: string): Array<{ name: string; text: string }> {
  const dir = path.join(FIXTURES_ROOT, engine)
  return readdirSync(dir).map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf-8") }))
}

/** A message that echoes a meaningful (non-whitespace-only) 20-character
 * chunk of the raw input verbatim is treated as a leak. */
function findLeakedChunk(message: string, rawContent: string): string | undefined {
  const WINDOW = 20
  const trimmed = rawContent.trim()
  for (let i = 0; i + WINDOW <= trimmed.length; i += 4) {
    const chunk = trimmed.slice(i, i + WINDOW)
    if (chunk.replace(/\s+/g, " ").trim().length < 10) continue // skip mostly-whitespace windows
    if (message.includes(chunk)) return chunk
  }
  return undefined
}

interface ParserUnderTest {
  engine: string
  fixtureDir: string
  attempt: (text: string) => unknown
}

const PARSERS: ParserUnderTest[] = [
  { engine: "postgres-json", fixtureDir: "postgres", attempt: parsePostgresJsonPlan },
  { engine: "postgres-text", fixtureDir: "postgres", attempt: parsePostgresTextPlan },
  { engine: "sqlserver", fixtureDir: "sqlserver", attempt: parseSqlServerShowplanXml },
  { engine: "snowflake", fixtureDir: "snowflake", attempt: parseSnowflakeOperatorStats },
]

describe("parser error messages never leak raw pasted content", () => {
  let sawAtLeastOneError = false

  for (const { engine, fixtureDir, attempt } of PARSERS) {
    describe(engine, () => {
      for (const { name, text } of readFixtureDir(fixtureDir)) {
        it(`${name}: throws a structural error or succeeds — never an error that echoes the input`, () => {
          try {
            attempt(text)
            // Parsed successfully — nothing to check here, this fixture is
            // covered by its own parser's positive tests.
          } catch (err) {
            if (!(err instanceof PlanParseError)) throw err // a real bug, let it fail loudly
            sawAtLeastOneError = true
            const leaked = findLeakedChunk(err.message, text)
            expect(leaked, `error message leaked raw content: "${leaked}"`).toBeUndefined()
            expect(err.message.length).toBeLessThan(300) // bounded — never "here's your whole input back"
          }
        })
      }
    })
  }

  it("sanity check: this suite actually exercised at least one error path (not vacuously passing)", () => {
    expect(sawAtLeastOneError).toBe(true)
  })
})
