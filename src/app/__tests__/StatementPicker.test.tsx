import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { PlanNode } from "../../parsers/normalize"
import { StatementPicker } from "../StatementPicker"

function root(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    id: "n0",
    type: "unknown",
    rawOperatorLabel: "Op",
    engine: "sqlserver",
    children: [],
    warnings: [],
    ...overrides,
  } as PlanNode
}

// Real statements carry a cost; trivial ones carry none.
const real = (label: string, cost = 5) => ({ label, root: root({ estimatedCost: cost }) })
const trivial = (label: string) => ({ label, root: root() })

function setup(statements = [real("SELECT a"), trivial("DECLARE @x"), trivial("SET @x = 1"), real("SELECT b")], activeIndex = 0) {
  const onSelect = vi.fn()
  const onToggleGroup = vi.fn()
  render(<StatementPicker statements={statements} activeIndex={activeIndex} expandedGroups={new Set()} onToggleGroup={onToggleGroup} onSelect={onSelect} />)
  return { onSelect, onToggleGroup }
}

describe("StatementPicker", () => {
  it("shows the active statement and its position on the closed trigger, with the list hidden", () => {
    setup()
    const trigger = screen.getByTestId("statement-picker-trigger")
    expect(trigger).toHaveTextContent("1 of 4")
    expect(trigger).toHaveTextContent("SELECT a")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("groups a trivial run and selects a statement on click", () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    expect(screen.getByTestId("statement-tab-group")).toHaveTextContent("2 control-flow statements — expand")
    fireEvent.click(screen.getByText("SELECT b"))
    expect(onSelect).toHaveBeenCalledWith(3)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("reports a group toggle without selecting or closing", () => {
    const { onSelect, onToggleGroup } = setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    fireEvent.click(screen.getByTestId("statement-tab-group"))
    expect(onToggleGroup).toHaveBeenCalledWith(1, false)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })

  it("search flattens grouping so a statement inside a collapsed run is reachable", () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    fireEvent.change(screen.getByTestId("statement-picker-search"), { target: { value: "declare" } })
    expect(screen.queryByTestId("statement-tab-group")).toBeNull()
    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(1)
    fireEvent.click(options[0])
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it("shows an empty state when nothing matches", () => {
    setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    fireEvent.change(screen.getByTestId("statement-picker-search"), { target: { value: "zzz" } })
    expect(screen.getByTestId("statement-picker-empty")).toBeInTheDocument()
  })

  it("supports arrow keys + Enter, and Escape closes without selecting", () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    const search = screen.getByTestId("statement-picker-search")
    // rows: [SELECT a, group, SELECT b]; highlight starts on the active one.
    fireEvent.keyDown(search, { key: "ArrowDown" })
    fireEvent.keyDown(search, { key: "ArrowDown" })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledWith(3)

    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    fireEvent.keyDown(screen.getByTestId("statement-picker-search"), { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("closes on an outside pointer press", () => {
    setup()
    fireEvent.click(screen.getByTestId("statement-picker-trigger"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})
