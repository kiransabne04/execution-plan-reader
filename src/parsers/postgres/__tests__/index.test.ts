import { describe, expect, it } from "vitest"
import { parsePostgresPlan } from "../index"
import { loadFixture } from "./testUtils"

describe("parsePostgresPlan (format dispatcher)", () => {
  it("routes JSON-shaped input to the JSON parser", () => {
    const root = parsePostgresPlan(loadFixture("simple-seq-scan.json"))
    expect(root.rawOperatorLabel).toBe("Seq Scan")
    expect(root.actualRows).toBe(1180)
  })

  it("routes TEXT-shaped input to the TEXT parser", () => {
    const root = parsePostgresPlan(loadFixture("simple-seq-scan-text.txt"))
    expect(root.rawOperatorLabel).toBe("Seq Scan")
    expect(root.actualRows).toBe(1180)
  })
})
