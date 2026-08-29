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

  // Episode 18, Story 18.13 — posts.ts ships with zero real entries by
  // design (see that file's own comment); this locks in that the
  // currently-shipped app never shows a broken/empty content-stack
  // section for real fixture-shaped nodes, using the REAL posts.ts, not
  // a mock.
  it("never shows the content stack today — the real posts.ts is intentionally empty", () => {
    const node = makeNode({ engine: "postgres", operatorType: "hash_join", actualTimeMs: 5 })
    renderPanel(node)
    expect(screen.queryByTestId("content-stack")).not.toBeInTheDocument()
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

  it("hides raw attributes in Beginner mode and reveals them, EXPANDED, in Expert mode (Story 18.7)", () => {
    const node = makeNode({ attributes: { "Relation Name": "orders" } })
    renderPanel(node)
    expect(screen.queryByTestId("raw-attributes")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    expect(screen.getByTestId("raw-attributes")).toBeInTheDocument()
    // Story 18.7 (spec §5 1f): expanded by default on entering Expert mode
    // — reversed from the pre-18.7 collapsed-by-default behavior.
    expect(screen.getByText(/Relation Name: orders/)).toBeInTheDocument()

    // Still manually collapsible afterward.
    fireEvent.click(screen.getByRole("button", { name: /Raw attributes/ }))
    expect(screen.queryByText(/Relation Name: orders/)).not.toBeInTheDocument()
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

  describe("Episode 18, Story 18.3 — controlled expertMode (lifted page-level state)", () => {
    it("reflects the controlled expertMode prop instead of defaulting to Beginner", () => {
      const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
      const context = buildPlanContext(node)
      applyRules(node, context)
      render(<DetailPanel node={node} context={context} onClose={() => {}} expertMode onExpertModeChange={() => {}} />)

      expect(screen.getByRole("button", { name: "Expert" })).toHaveAttribute("aria-pressed", "true")
      // Expert-mode content (longText) is showing, not Beginner's shortText.
      const before = screen.getByTestId("warning-item").textContent
      expect(before!.length).toBeGreaterThan(0)
    })

    it("calls onExpertModeChange instead of managing its own state when controlled — clicking Beginner doesn't flip the panel back on its own", () => {
      let controlledValue = true
      const onExpertModeChange = (next: boolean) => {
        controlledValue = next
      }
      const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
      const context = buildPlanContext(node)
      applyRules(node, context)
      render(
        <DetailPanel node={node} context={context} onClose={() => {}} expertMode={controlledValue} onExpertModeChange={onExpertModeChange} />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Beginner" }))
      // The panel is still rendering with the prop it was given (true) —
      // it never had its own state to flip. The callback is what fired.
      expect(screen.getByRole("button", { name: "Expert" })).toHaveAttribute("aria-pressed", "true")
      expect(controlledValue).toBe(false)
    })

    it("without expertMode/onExpertModeChange (every non-shell caller), the panel keeps managing its own state exactly as before this story", () => {
      const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
      renderPanel(node)
      expect(screen.getByRole("button", { name: "Beginner" })).toHaveAttribute("aria-pressed", "true")
      fireEvent.click(screen.getByRole("button", { name: "Expert" }))
      expect(screen.getByRole("button", { name: "Expert" })).toHaveAttribute("aria-pressed", "true")
    })
  })

  describe("Episode 18, Story 18.7 — Beginner/Expert densities (spec §5 1f)", () => {
    it("Beginner shows the LONG definition plus the full 'In general' guidance", () => {
      const node = makeNode({ operatorType: "seq_scan" })
      renderPanel(node)
      expect(screen.getByText(/also called a table scan or full scan/)).toBeInTheDocument()
      expect(screen.getByTestId("operator-education-general")).toBeInTheDocument()
      // The short (Expert) definition is NOT also shown alongside it.
      expect(screen.queryByText(/^Reads every row in a table/)).not.toBeInTheDocument()
    })

    it("Expert collapses education to the one-line short definition, omitting 'In general' entirely", () => {
      const node = makeNode({ operatorType: "seq_scan" })
      renderPanel(node)
      fireEvent.click(screen.getByRole("button", { name: "Expert" }))

      expect(screen.getByText(/Reads every row in a table/)).toBeInTheDocument()
      expect(screen.queryByText(/also called a table scan or full scan/)).not.toBeInTheDocument()
      expect(screen.queryByTestId("operator-education-general")).not.toBeInTheDocument()
    })

    it("shows each finding's ruleId in Expert mode, never in Beginner", () => {
      const node = makeNode({ operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
      renderPanel(node)
      expect(screen.queryByTestId("warning-rule-id")).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "Expert" }))
      expect(screen.getByTestId("warning-rule-id")).toHaveTextContent("seq-scan-on-large-table")
    })

    it("Beginner curates stat rows (hides gaps), Expert shows the full set including them", () => {
      // Snowflake nodes never populate ioReadTimeMs/ioWriteTimeMs — a
      // real, honest gap (field catalog), not a fabricated zero.
      const node = makeNode({ engine: "snowflake", operatorType: "seq_scan", actualRows: 100 })
      renderPanel(node)
      const statsTable = screen.getByTestId("stats-table")
      expect(statsTable.querySelector(".detail-panel__stat-gap")).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "Expert" }))
      expect(screen.getByTestId("stats-table").querySelector(".detail-panel__stat-gap")).toBeInTheDocument()
    })
  })
})
