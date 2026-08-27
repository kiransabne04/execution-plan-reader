import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DetailPanel } from "../DetailPanel"
import { applyRules } from "../../../rules/index"
import { buildPlanContext } from "../../../rules/types"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import type { PlanNode } from "../../../parsers/normalize"

function renderPanel(node: PlanNode, contextOverrides: Parameters<typeof buildPlanContext>[1] = {}) {
  const context = buildPlanContext(node, contextOverrides)
  applyRules(node, context)
  const onClose = () => {}
  render(<DetailPanel node={node} context={context} onClose={onClose} />)
  return { context }
}

describe("DetailPanel", () => {
  it("renders header (display name, raw label implicitly, engine badge), education, stats, contribution, query, and raw-attributes sections", () => {
    const node = makeNode({ engine: "postgres", operatorType: "hash_join", rawOperatorLabel: "Hash Join", actualTimeMs: 5 })
    renderPanel(node)

    expect(screen.getByTestId("detail-panel-display-name")).toHaveTextContent("Hash Join")
    expect(screen.getByText("Postgres")).toBeInTheDocument()
    expect(screen.getByTestId("operator-education-what")).toBeInTheDocument()
    expect(screen.getByTestId("operator-education-general")).toBeInTheDocument()
    expect(screen.getByTestId("stats-table")).toBeInTheDocument()
    expect(screen.getByTestId("contribution-summary")).toBeInTheDocument()
    expect(screen.getByTestId("query-correlation")).toBeInTheDocument()
  })

  it("omits the warnings section entirely when the node has no warnings — not padded with filler", () => {
    const node = makeNode({ operatorType: "seq_scan", actualRows: 5 })
    renderPanel(node)
    expect(screen.queryByTestId("warnings-section")).not.toBeInTheDocument()
  })

  it("shows the warnings section when the node has a real finding, using shortText in Beginner mode", () => {
    const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
    renderPanel(node)
    expect(screen.getByTestId("warnings-section")).toBeInTheDocument()
    expect(screen.getByTestId("warning-item")).toHaveTextContent("events")
  })

  it("switches warning text from shortText to longText when Expert mode is toggled", () => {
    const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
    renderPanel(node)
    const before = screen.getByTestId("warning-item").textContent
    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    const after = screen.getByTestId("warning-item").textContent
    expect(after).not.toBe(before)
    expect(after!.length).toBeGreaterThan(before!.length)
  })

  it("shows the operator-education fallback (never blank) for an unmapped operatorType", () => {
    const node = makeNode({ operatorType: "some_future_operator", rawOperatorLabel: "Some Future Op" })
    renderPanel(node)
    expect(screen.getByTestId("operator-education-fallback")).toBeInTheDocument()
    expect(screen.queryByTestId("operator-education-what")).not.toBeInTheDocument()
  })

  it("shows 100% contribution for a single-node (root) plan", () => {
    const node = makeNode({ actualTimeMs: 42 })
    renderPanel(node)
    expect(screen.getByTestId("contribution-summary")).toHaveTextContent("100.0%")
  })

  it("shows a graceful 'not available' contribution on a zero-total plan, never NaN%", () => {
    const node = makeNode({ actualTimeMs: 0, estimatedCost: 0 })
    renderPanel(node)
    const section = screen.getByTestId("contribution-summary")
    expect(section).not.toHaveTextContent(/NaN/)
    expect(section).toHaveTextContent("Not available")
  })

  it("states plainly when Snowflake query text is redacted, rather than silently omitting the section", () => {
    const node = makeNode({ engine: "snowflake" })
    renderPanel(node, { queryTextRedacted: true })
    expect(screen.getByTestId("query-text-unavailable")).toHaveTextContent(/redacted/i)
  })

  it("states plainly when no query text is available at all (the common Postgres case)", () => {
    const node = makeNode({ engine: "postgres" })
    renderPanel(node)
    expect(screen.getByTestId("query-text-unavailable")).toHaveTextContent(/no query text available/i)
  })

  it("shows the actual query text when available (SQL Server statementText)", () => {
    const node = makeNode({ engine: "sqlserver" })
    renderPanel(node, { statementText: "SELECT * FROM Orders" })
    expect(screen.getByTestId("query-correlation")).toHaveTextContent("SELECT * FROM Orders")
  })

  it("hides raw attributes in Beginner mode and reveals them (collapsed) in Expert mode", () => {
    const node = makeNode({ attributes: { "Relation Name": "orders" } })
    renderPanel(node)
    expect(screen.queryByTestId("raw-attributes")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    expect(screen.getByTestId("raw-attributes")).toBeInTheDocument()
    // Collapsed by default even in Expert mode — content only after expanding.
    expect(screen.queryByText(/Relation Name: orders/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Raw attributes/ }))
    expect(screen.getByText(/Relation Name: orders/)).toBeInTheDocument()
  })

  it("closes when the close button is clicked", () => {
    const node = makeNode({})
    const context = buildPlanContext(node)
    let closed = false
    render(<DetailPanel node={node} context={context} onClose={() => (closed = true)} />)
    fireEvent.click(screen.getByRole("button", { name: "Close details" }))
    expect(closed).toBe(true)
  })

  it("closes on Escape", () => {
    const node = makeNode({})
    const context = buildPlanContext(node)
    let closed = false
    render(<DetailPanel node={node} context={context} onClose={() => (closed = true)} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(closed).toBe(true)
  })

  it("shows the two-row cumulated/per-execution time split for a SQL-Server-shaped multi-thread node", () => {
    const node = makeNode({
      engine: "sqlserver",
      actualTimeMs: 120,
      actualTimePerExecutionMs: 40,
      parallel: { workersLaunched: 3 },
    })
    renderPanel(node)
    expect(screen.getByText(/Total \(cumulated across 3 workers\/threads\)/)).toBeInTheDocument()
    expect(screen.getByText("Per-execution (approx.)")).toBeInTheDocument()
  })

  it("shows a single Time row (no cumulated split) for a plain Postgres node", () => {
    const node = makeNode({ engine: "postgres", actualTimeMs: 5, actualTimePerExecutionMs: 5 })
    renderPanel(node)
    expect(screen.getByText("Time")).toBeInTheDocument()
    expect(screen.queryByText(/cumulated across/)).not.toBeInTheDocument()
  })
})
