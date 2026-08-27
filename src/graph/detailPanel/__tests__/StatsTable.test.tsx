import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatsTable } from "../StatsTable"
import { buildStatRows } from "../buildStatRows"
import { makeNode } from "../../../rules/__tests__/testHelpers"

describe("StatsTable", () => {
  it("renders a long predicate/seek condition as a full-width block, visible without Expert mode", () => {
    render(
      <StatsTable
        node={makeNode({
          engine: "sqlserver",
          actualRows: 5,
          index: { name: "IX_Orders_CustomerId_OrderDate" },
          predicate: { indexCondition: "[CustomerId]=(42) AND [OrderDate]=('2024-01-01')" },
        })}
      />,
    )
    const block = screen.getByTestId("stat-block")
    expect(block).toHaveTextContent("Index condition")
    expect(block).toHaveTextContent("[CustomerId]=(42) AND [OrderDate]=('2024-01-01')")
  })

  it("keeps short scalar stats (rows, index name) in the compact table, not as blocks", () => {
    render(<StatsTable node={makeNode({ engine: "sqlserver", actualRows: 5, index: { name: "IX_Foo" } })} />)
    expect(screen.queryByTestId("stat-block")).not.toBeInTheDocument()
    expect(screen.getByTestId("stats-table").querySelector("table")).toBeInTheDocument()
  })

  it("preserves buildStatRows's own order across a mixed table/block sequence, never reordering", () => {
    const node = makeNode({
      engine: "sqlserver",
      index: { name: "IX_Foo" },
      predicate: { indexCondition: "[a]=(1)" },
      join: { logicalType: "inner" },
    })
    const expectedOrder = buildStatRows(node).map((r) => r.label)
    render(<StatsTable node={node} />)
    const section = screen.getByTestId("stats-table")
    const labels = Array.from(section.querySelectorAll("td:first-child, .detail-panel__stat-block-label")).map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(expectedOrder)
  })
})
