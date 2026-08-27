import { describe, expect, it } from "vitest"
import { getFunnelCallout } from "../funnelCallouts"

describe("getFunnelCallout", () => {
  it("maps Postgres to pgsuite", () => {
    const callout = getFunnelCallout("postgres")
    expect(callout?.product).toBe("pgsuite")
  })

  it("maps Snowflake to QueryDoc", () => {
    const callout = getFunnelCallout("snowflake")
    expect(callout?.product).toBe("querydoc")
  })

  // SQL Server has no funnel product (PRD: it's a credibility/reach play,
  // not one of the two funnel-mapped engines) — this is the structural
  // guarantee against Story 9.1's cross-engine-mixup edge case: since this
  // function is the ONLY source of a callout, and it's keyed strictly by
  // engine, a Postgres finding can never surface a QueryDoc link or vice versa.
  it("returns undefined for SQL Server — no cross-wired or fallback callout", () => {
    expect(getFunnelCallout("sqlserver")).toBeUndefined()
  })

  it("never returns a pgsuite callout for Snowflake or a QueryDoc callout for Postgres", () => {
    expect(getFunnelCallout("postgres")?.product).not.toBe("querydoc")
    expect(getFunnelCallout("snowflake")?.product).not.toBe("pgsuite")
  })
})
