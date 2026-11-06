import { beforeEach, describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WarningsSection } from "../WarningsSection"
import type { Warning } from "../../../parsers/normalize"

const warning: Warning = {
  ruleId: "seq-scan-on-large-table",
  severity: "warning",
  shortText: "short",
  longText: "long",
}

describe("WarningsSection funnel callout (Story 9.1)", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it("shows the PostgreSQL investigation callout alongside a real Postgres warning", () => {
    render(<WarningsSection warnings={[warning]} expertMode={false} engine="postgres" />)
    const callout = screen.getByTestId("funnel-callout")
    expect(callout).toHaveTextContent(/production workload investigation/i)
    expect(callout.querySelector("a")).toHaveAttribute("href", expect.stringContaining("/postgresql-performance-investigation?"))
  })

  it("shows the Snowflake capability callout alongside a real Snowflake warning", () => {
    render(<WarningsSection warnings={[warning]} expertMode={false} engine="snowflake" />)
    const callout = screen.getByTestId("funnel-callout")
    expect(callout.querySelector("a")).toHaveAttribute("href", expect.stringContaining("/snowflake-performance?"))
  })

  it("shows the SQL Server capability callout alongside a real SQL Server warning", () => {
    render(<WarningsSection warnings={[warning]} expertMode={false} engine="sqlserver" />)
    expect(screen.getByTestId("funnel-callout").querySelector("a")).toHaveAttribute("href", expect.stringContaining("/sql-server-performance?"))
  })

  it("never shows a callout when there's no warning to tie it to — not a generic banner", () => {
    render(<WarningsSection warnings={[]} expertMode={false} engine="postgres" />)
    expect(screen.queryByTestId("funnel-callout")).not.toBeInTheDocument()
  })

  it("dismisses on click and stays dismissed across a re-render (session-scoped)", () => {
    const { unmount } = render(<WarningsSection warnings={[warning]} expertMode={false} engine="postgres" />)
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))
    expect(screen.queryByTestId("funnel-callout")).not.toBeInTheDocument()
    unmount()

    render(<WarningsSection warnings={[warning]} expertMode={false} engine="postgres" />)
    expect(screen.queryByTestId("funnel-callout")).not.toBeInTheDocument()
  })

  it("dismissing PostgreSQL doesn't dismiss Snowflake — scoped per product", () => {
    render(<WarningsSection warnings={[warning]} expertMode={false} engine="postgres" />)
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))

    render(<WarningsSection warnings={[warning]} expertMode={false} engine="snowflake" />)
    expect(screen.getByTestId("funnel-callout")).toBeInTheDocument()
  })

  it("dismissing never hides the warning itself — core content stays fully usable", () => {
    render(<WarningsSection warnings={[warning]} expertMode={false} engine="postgres" />)
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))
    expect(screen.getByTestId("warning-item")).toBeInTheDocument()
  })
})
