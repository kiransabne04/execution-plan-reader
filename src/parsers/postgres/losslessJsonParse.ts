// Non-negotiable rule (see .claude/skills/postgres-plan-parsing/SKILL.md):
// never use the browser's native JSON.parse() on Postgres plan JSON. Postgres
// has shipped plans with duplicate keys on one object (e.g. two "Workers"
// blocks on a single node) — native JSON.parse() silently keeps only the
// last one and drops the other with no error. This hand-rolled recursive-
// descent parser merges duplicate keys into an array instead, so no data is
// ever silently lost.
//
// Error messages here are structural only ("unexpected end of input at
// position N") and never echo back a snippet of the raw input — see the
// privacy-architecture skill.

import { PlanParseError } from "../normalize"

// Identifies arrays produced by merging a duplicate key, so downstream code
// can distinguish "this field really is an array" from "this key appeared
// twice and we merged the two values" without guessing.
const duplicateKeyMerges = new WeakSet<object>()

export function isDuplicateKeyMerge(value: unknown): value is unknown[] {
  return Array.isArray(value) && duplicateKeyMerges.has(value)
}

export function parseLosslessJson(input: string): unknown {
  const parser = new Parser(input)
  const value = parser.parseValue()
  parser.skipWhitespace()
  if (!parser.atEnd()) {
    throw new PlanParseError(
      "INVALID_JSON",
      `Unexpected trailing content after JSON value at position ${parser.pos}`,
      parser.pos,
    )
  }
  return value
}

class Parser {
  private readonly input: string
  pos = 0

  constructor(input: string) {
    this.input = input
  }

  atEnd(): boolean {
    return this.pos >= this.input.length
  }

  private peek(): string {
    if (this.atEnd()) {
      throw new PlanParseError(
        "TRUNCATED_INPUT",
        `JSON input ended unexpectedly at position ${this.pos} (looks like it got cut off)`,
        this.pos,
      )
    }
    return this.input[this.pos]
  }

  skipWhitespace(): void {
    while (!this.atEnd() && /[\s]/.test(this.input[this.pos])) {
      this.pos++
    }
  }

  parseValue(): unknown {
    this.skipWhitespace()
    const ch = this.peek()
    if (ch === "{") return this.parseObject()
    if (ch === "[") return this.parseArray()
    if (ch === '"') return this.parseString()
    if (ch === "t" || ch === "f") return this.parseBoolean()
    if (ch === "n") return this.parseNull()
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber()
    throw new PlanParseError(
      "INVALID_JSON",
      `Unexpected character at position ${this.pos} while looking for a JSON value`,
      this.pos,
    )
  }

  private parseObject(): Record<string, unknown> {
    this.expect("{")
    const result: Record<string, unknown> = {}
    const seen = new Set<string>()
    this.skipWhitespace()
    if (this.peek() === "}") {
      this.pos++
      return result
    }
    for (;;) {
      this.skipWhitespace()
      if (this.peek() !== '"') {
        throw new PlanParseError(
          "INVALID_JSON",
          `Expected an object key (string) at position ${this.pos}`,
          this.pos,
        )
      }
      const key = this.parseString()
      this.skipWhitespace()
      this.expect(":")
      const value = this.parseValue()
      this.mergeInto(result, seen, key, value)
      this.skipWhitespace()
      const next = this.peek()
      if (next === ",") {
        this.pos++
        continue
      }
      if (next === "}") {
        this.pos++
        break
      }
      throw new PlanParseError(
        "INVALID_JSON",
        `Expected ',' or '}' at position ${this.pos}`,
        this.pos,
      )
    }
    return result
  }

  /** Duplicate-key-tolerant assignment: merge instead of silently overwrite. */
  private mergeInto(
    result: Record<string, unknown>,
    seen: Set<string>,
    key: string,
    value: unknown,
  ): void {
    if (!seen.has(key)) {
      seen.add(key)
      result[key] = value
      return
    }
    const existing = result[key]
    if (isDuplicateKeyMerge(existing)) {
      existing.push(value)
      return
    }
    const merged = [existing, value]
    duplicateKeyMerges.add(merged)
    result[key] = merged
  }

  private parseArray(): unknown[] {
    this.expect("[")
    const result: unknown[] = []
    this.skipWhitespace()
    if (this.peek() === "]") {
      this.pos++
      return result
    }
    for (;;) {
      result.push(this.parseValue())
      this.skipWhitespace()
      const next = this.peek()
      if (next === ",") {
        this.pos++
        continue
      }
      if (next === "]") {
        this.pos++
        break
      }
      throw new PlanParseError(
        "INVALID_JSON",
        `Expected ',' or ']' at position ${this.pos}`,
        this.pos,
      )
    }
    return result
  }

  private parseString(): string {
    this.expect('"')
    let out = ""
    for (;;) {
      const ch = this.peek()
      if (ch === '"') {
        this.pos++
        break
      }
      if (ch === "\\") {
        this.pos++
        const esc = this.peek()
        switch (esc) {
          case '"':
            out += '"'
            break
          case "\\":
            out += "\\"
            break
          case "/":
            out += "/"
            break
          case "b":
            out += "\b"
            break
          case "f":
            out += "\f"
            break
          case "n":
            out += "\n"
            break
          case "r":
            out += "\r"
            break
          case "t":
            out += "\t"
            break
          case "u": {
            const hex = this.input.slice(this.pos + 1, this.pos + 5)
            if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new PlanParseError(
                "TRUNCATED_INPUT",
                `Invalid or incomplete unicode escape at position ${this.pos}`,
                this.pos,
              )
            }
            out += String.fromCharCode(parseInt(hex, 16))
            this.pos += 4
            break
          }
          default:
            throw new PlanParseError(
              "INVALID_JSON",
              `Invalid escape sequence at position ${this.pos}`,
              this.pos,
            )
        }
        this.pos++
        continue
      }
      out += ch
      this.pos++
    }
    return out
  }

  private parseBoolean(): boolean {
    if (this.input.startsWith("true", this.pos)) {
      this.pos += 4
      return true
    }
    if (this.input.startsWith("false", this.pos)) {
      this.pos += 5
      return false
    }
    throw new PlanParseError(
      "INVALID_JSON",
      `Unexpected token at position ${this.pos}`,
      this.pos,
    )
  }

  private parseNull(): null {
    if (this.input.startsWith("null", this.pos)) {
      this.pos += 4
      return null
    }
    throw new PlanParseError(
      "INVALID_JSON",
      `Unexpected token at position ${this.pos}`,
      this.pos,
    )
  }

  private parseNumber(): number {
    const start = this.pos
    if (this.input[this.pos] === "-") this.pos++
    while (!this.atEnd() && /[0-9]/.test(this.input[this.pos])) this.pos++
    if (!this.atEnd() && this.input[this.pos] === ".") {
      this.pos++
      while (!this.atEnd() && /[0-9]/.test(this.input[this.pos])) this.pos++
    }
    if (!this.atEnd() && (this.input[this.pos] === "e" || this.input[this.pos] === "E")) {
      this.pos++
      if (!this.atEnd() && (this.input[this.pos] === "+" || this.input[this.pos] === "-")) this.pos++
      while (!this.atEnd() && /[0-9]/.test(this.input[this.pos])) this.pos++
    }
    const text = this.input.slice(start, this.pos)
    if (text === "" || text === "-") {
      throw new PlanParseError(
        "INVALID_JSON",
        `Invalid number at position ${start}`,
        start,
      )
    }
    return Number(text)
  }

  private expect(ch: string): void {
    const actual = this.peek()
    if (actual !== ch) {
      throw new PlanParseError(
        "INVALID_JSON",
        `Expected '${ch}' at position ${this.pos}`,
        this.pos,
      )
    }
    this.pos++
  }
}
