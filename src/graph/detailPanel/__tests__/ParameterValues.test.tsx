import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ParameterValues } from "../ParameterValues"

describe("ParameterValues", () => {
  it("renders nothing when parameters is undefined", () => {
    const { container } = render(<ParameterValues />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when parameters is an empty array", () => {
    const { container } = render(<ParameterValues parameters={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders each parameter's compiled and runtime value", () => {
    render(
      <ParameterValues
        parameters={[
          { name: "@CustomerId", compiledValue: "1", runtimeValue: "42" },
          { name: "@Status", compiledValue: "'new'", runtimeValue: "'active'" },
        ]}
      />,
    )
    expect(screen.getByTestId("parameter-values")).toBeInTheDocument()
    expect(screen.getByText("@CustomerId")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("42")).toBeInTheDocument()
  })

  it("marks a row as differing when compiled and runtime values are not equal", () => {
    render(<ParameterValues parameters={[{ name: "@CustomerId", compiledValue: "1", runtimeValue: "42" }]} />)
    const row = screen.getByText("@CustomerId").closest("tr")
    expect(row?.className).toContain("differs")
  })

  it("does not mark a row as differing when compiled and runtime values match", () => {
    render(<ParameterValues parameters={[{ name: "@Status", compiledValue: "'active'", runtimeValue: "'active'" }]} />)
    const row = screen.getByText("@Status").closest("tr")
    expect(row?.className).toBe("")
  })

  it("shows an em dash for a missing compiled or runtime value, never blank or 'undefined'", () => {
    render(<ParameterValues parameters={[{ name: "@Only", runtimeValue: "42" }]} />)
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByText("undefined")).not.toBeInTheDocument()
  })
})
