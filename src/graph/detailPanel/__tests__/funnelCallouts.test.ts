import { describe, expect, it } from "vitest"
import { getFunnelCallout, getSummaryHandoffText, WALSTACK_CREATOR_URL, WALSTACK_HEADER_HELP_URL, WALSTACK_POSTGRES_URL, WALSTACK_SAMPLE_REPORT_URL, WALSTACK_SQLSERVER_URL, WALSTACK_SNOWFLAKE_URL } from "../funnelCallouts"

describe("getFunnelCallout", () => {
  it("maps Postgres to the production investigation with the exact fixed campaign URL", () => {
    const callout = getFunnelCallout("postgres")
    expect(callout.product).toBe("walstack-postgres")
    expect(callout.url).toBe("https://walstack.io/postgresql-performance-investigation?utm_source=planreader&utm_medium=tool&utm_campaign=postgres_plan_handoff")
    expect(callout.url).toBe(WALSTACK_POSTGRES_URL)
    expect(callout.text).toMatch(/production workload investigation/)
    expect(callout.cta).toBe("Explore professional PostgreSQL help")
  })

  it("maps SQL Server and Snowflake to their own capability pages", () => {
    expect(getFunnelCallout("sqlserver").url).toBe(WALSTACK_SQLSERVER_URL)
    expect(getFunnelCallout("snowflake").url).toBe(WALSTACK_SNOWFLAKE_URL)
    expect(getFunnelCallout("sqlserver").url).toContain("/sql-server-performance?")
    expect(getFunnelCallout("snowflake").url).toContain("/snowflake-performance?")
  })

  it("keeps every destination fixed and free of plan-derived values", () => {
    for (const destination of [WALSTACK_POSTGRES_URL, WALSTACK_SQLSERVER_URL, WALSTACK_SNOWFLAKE_URL, WALSTACK_SAMPLE_REPORT_URL, WALSTACK_CREATOR_URL, WALSTACK_HEADER_HELP_URL]) {
      const url = new URL(destination)
      expect(url.origin).toBe("https://walstack.io")
      expect([...url.searchParams.keys()]).toEqual(["utm_source", "utm_medium", "utm_campaign"])
      expect(url.hash).toBe("")
    }
  })

  it("explains the clean-plan boundary without implying a diagnosis", () => {
    expect(getSummaryHandoffText("postgres", false)).toMatch(/clean plan does not rule out a production problem/)
    expect(getSummaryHandoffText("postgres", true)).toMatch(/rank safe changes/)
  })
})
