import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StatisticsIoComparePanel } from "../StatisticsIoComparePanel"
import { loadFixture } from "../../parsers/sqlserver/__tests__/testUtils"

describe("StatisticsIoComparePanel", () => {
  it("shows nothing until both sides are pasted, then a headline and per-table rows", () => {
    render(<StatisticsIoComparePanel />)
    expect(screen.queryByTestId("sio-result")).toBeNull()

    fireEvent.change(screen.getByTestId("sio-before"), { target: { value: loadFixture("statistics-io-before.txt") } })
    expect(screen.queryByTestId("sio-result")).toBeNull()

    fireEvent.change(screen.getByTestId("sio-after"), { target: { value: loadFixture("statistics-io-after.txt") } })
    expect(screen.getByTestId("sio-headline")).toHaveTextContent("logical reads decreased by 99% (52,023 → 441)")
    expect(screen.getByTestId("sio-result")).toHaveTextContent("Orders")
    expect(screen.getByTestId("sio-result")).toHaveTextContent("only in After")
  })

  it("warns, without echoing the pasted text, when a box has no STATISTICS IO lines", () => {
    render(<StatisticsIoComparePanel />)
    fireEvent.change(screen.getByTestId("sio-before"), { target: { value: "SELECT secret FROM payroll" } })
    const warning = screen.getByTestId("sio-unrecognized")
    expect(warning).toHaveTextContent("Before box")
    expect(warning).not.toHaveTextContent("payroll")
  })
})
