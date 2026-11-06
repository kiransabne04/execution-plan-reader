import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { FindingsHandoff } from "../FindingsHandoff"
import { FunnelCallout } from "../../detailPanel/FunnelCallout"
import { getFunnelCallout, WALSTACK_POSTGRES_URL } from "../../detailPanel/funnelCallouts"

describe("FindingsHandoff", () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, "", "/")
  })

  it("shows the PostgreSQL investigation after a finding and never forwards a share fragment", () => {
    window.history.replaceState(null, "", "/#private-plan-content")
    render(<FindingsHandoff engine="postgres" hasFindings />)
    const card = screen.getByTestId("findings-handoff")
    expect(card).toHaveTextContent(/rank safe changes/)
    expect(within(card).getByRole("link")).toHaveAttribute("href", WALSTACK_POSTGRES_URL)
    expect(within(card).getByRole("link").getAttribute("href")).not.toContain("private-plan-content")
  })

  it("explains that a clean PostgreSQL plan does not rule out a production problem", () => {
    render(<FindingsHandoff engine="postgres" hasFindings={false} />)
    expect(screen.getByTestId("findings-handoff")).toHaveTextContent(/clean plan does not rule out a production problem/)
  })

  it("uses restrained engine-specific paths for SQL Server and Snowflake", () => {
    const { rerender } = render(<FindingsHandoff engine="sqlserver" hasFindings />)
    expect(screen.getByRole("link").getAttribute("href")).toContain("/sql-server-performance?")
    rerender(<FindingsHandoff key="snowflake" engine="snowflake" hasFindings={false} />)
    expect(screen.getByRole("link").getAttribute("href")).toContain("/snowflake-performance?")
    expect(screen.getByTestId("findings-handoff")).toHaveTextContent(/clean plan does not rule out/)
  })

  it("dismisses the plan-wide and node callouts for the session without affecting the other engines", () => {
    render(<>
      <FindingsHandoff engine="postgres" hasFindings />
      <FunnelCallout callout={getFunnelCallout("postgres")} />
    </>)
    fireEvent.click(within(screen.getByTestId("findings-handoff")).getByRole("button", { name: /dismiss/i }))
    expect(screen.queryByTestId("findings-handoff")).not.toBeInTheDocument()
    expect(screen.queryByTestId("funnel-callout")).not.toBeInTheDocument()
    expect(sessionStorage.getItem("planreader.callout-dismissed.walstack-postgres")).toBe("true")
    render(<FindingsHandoff engine="snowflake" hasFindings />)
    expect(screen.getByTestId("findings-handoff")).toBeInTheDocument()
  })
})
