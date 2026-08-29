import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SearchPalette } from "../SearchPalette"
import { makeNode } from "../../../rules/__tests__/testHelpers"

describe("SearchPalette", () => {
  it("lists every node when the query is empty, and reports an inactive (undefined) matched set", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const onMatchedIdsChange = vi.fn()
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={() => {}} onMatchedIdsChange={onMatchedIdsChange} />)

    expect(screen.getAllByTestId("search-palette-result")).toHaveLength(2)
    expect(onMatchedIdsChange).toHaveBeenLastCalledWith(undefined)
  })

  it("narrows results as the query changes, and reports the active matched set", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const onMatchedIdsChange = vi.fn()
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={() => {}} onMatchedIdsChange={onMatchedIdsChange} />)

    fireEvent.change(screen.getByTestId("search-palette-input"), { target: { value: "hash" } })

    expect(screen.getAllByTestId("search-palette-result")).toHaveLength(1)
    expect(screen.getByText("Hash Join")).toBeInTheDocument()
    expect(onMatchedIdsChange).toHaveBeenLastCalledWith(new Set(["root"]))
  })

  it("shows an explicit 'no matches' state for a zero-match query, not an empty list", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByTestId("search-palette-input"), { target: { value: "nonexistent-xyz" } })

    expect(screen.getByTestId("search-palette-no-matches")).toBeInTheDocument()
    expect(screen.queryByTestId("search-palette-result")).not.toBeInTheDocument()
  })

  it("severity filter chips narrow results independently of the text query", () => {
    const critical = makeNode({
      id: "critical",
      rawOperatorLabel: "Seq Scan",
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }],
    })
    const clean = makeNode({ id: "clean", rawOperatorLabel: "Index Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [critical, clean] })
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={() => {}} />)

    fireEvent.click(screen.getByTestId("search-palette-severity-critical"))

    expect(screen.getAllByTestId("search-palette-result")).toHaveLength(1)
    expect(screen.getByText("Seq Scan")).toBeInTheDocument()
  })

  it("selecting a result fires onSelectNode with that node's id and closes the palette", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const onSelectNode = vi.fn()
    const onClose = vi.fn()
    render(<SearchPalette root={root} onSelectNode={onSelectNode} onClose={onClose} />)

    fireEvent.click(screen.getByText("Seq Scan"))

    expect(onSelectNode).toHaveBeenCalledWith("leaf")
    expect(onClose).toHaveBeenCalled()
  })

  it("Escape closes the palette", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    const onClose = vi.fn()
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={onClose} />)

    fireEvent.keyDown(screen.getByTestId("search-palette"), { key: "Escape" })

    expect(onClose).toHaveBeenCalled()
  })

  it("clicking the scrim (outside the palette) closes it", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    const onClose = vi.fn()
    render(<SearchPalette root={root} onSelectNode={() => {}} onClose={onClose} />)

    fireEvent.mouseDown(screen.getByTestId("search-palette-scrim"))

    expect(onClose).toHaveBeenCalled()
  })

  it("Enter selects the currently highlighted result", () => {
    const leaf = makeNode({ id: "leaf", rawOperatorLabel: "Seq Scan" })
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join", children: [leaf] })
    const onSelectNode = vi.fn()
    render(<SearchPalette root={root} onSelectNode={onSelectNode} onClose={() => {}} />)

    fireEvent.keyDown(screen.getByTestId("search-palette"), { key: "ArrowDown" })
    fireEvent.keyDown(screen.getByTestId("search-palette"), { key: "Enter" })

    expect(onSelectNode).toHaveBeenCalledWith("leaf")
  })

  it("reports undefined on unmount so a closed palette never leaves the graph dimmed", () => {
    const root = makeNode({ id: "root", rawOperatorLabel: "Hash Join" })
    const onMatchedIdsChange = vi.fn()
    const { unmount, getByTestId } = render(
      <SearchPalette root={root} onSelectNode={() => {}} onClose={() => {}} onMatchedIdsChange={onMatchedIdsChange} />,
    )
    fireEvent.change(getByTestId("search-palette-input"), { target: { value: "hash" } })
    onMatchedIdsChange.mockClear()

    unmount()

    expect(onMatchedIdsChange).toHaveBeenLastCalledWith(undefined)
  })
})
