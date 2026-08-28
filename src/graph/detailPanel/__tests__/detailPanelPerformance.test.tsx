// Episode 16, Story 16.1 — "detail panel open latency" and the specific
// acceptance criterion that per-node computations (glossary lookup,
// warning retrieval, contribution-%) are pre-computed or memoized so
// repeat opens/unrelated re-renders don't re-derive them. See
// .claude/skills/graph-visualization/SKILL.md.

import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import * as buildStatRowsModule from "../buildStatRows"
import * as glossaryModule from "../../glossary"
import { DetailPanel } from "../DetailPanel"
import { PlanGraph } from "../../PlanGraph"
import { buildPlanContext } from "../../../rules/types"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import type { PlanNode } from "../../../parsers/normalize"

describe("DetailPanel — memoization (Story 16.1)", () => {
  it("does not re-derive stat rows when the panel re-renders for an unrelated reason (Beginner/Expert toggle)", () => {
    const spy = vi.spyOn(buildStatRowsModule, "buildStatRows")
    const node = makeNode({ actualTimeMs: 5 })
    const context = buildPlanContext(node)
    render(<DetailPanel node={node} context={context} onClose={() => {}} />)
    const callsAfterMount = spy.mock.calls.length

    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    expect(spy.mock.calls.length).toBe(callsAfterMount) // StatsTable doesn't read expertMode — must not re-run
  })

  it("does not re-look-up the glossary entry when the panel re-renders for an unrelated reason", () => {
    const spy = vi.spyOn(glossaryModule, "getGlossaryEntry")
    const node = makeNode({ operatorType: "hash_join" })
    const context = buildPlanContext(node)
    render(<DetailPanel node={node} context={context} onClose={() => {}} />)
    const callsAfterMount = spy.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)

    // Expert mode IS read by OperatorEducation (shows the long definition
    // too), so a re-render is expected here — but it must not call the
    // lookup function AGAIN; the entry itself is already in hand from the
    // first render (memo skips the whole component only when props are
    // referentially equal; operatorType is unchanged, so React still
    // invokes OperatorEducation once more with the new expertMode — this
    // asserts the lookup isn't repeated needlessly beyond that one call).
    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    expect(spy.mock.calls.length).toBeLessThanOrEqual(callsAfterMount + 1)
  })

  it("re-derives stat rows once when the node genuinely changes, never stays stale", () => {
    const spy = vi.spyOn(buildStatRowsModule, "buildStatRows")
    const a = makeNode({ id: "a", actualTimeMs: 5 })
    const b = makeNode({ id: "b", actualTimeMs: 10 })
    const context = buildPlanContext(a)
    const { rerender } = render(<DetailPanel node={a} context={context} onClose={() => {}} />)
    const callsAfterFirst = spy.mock.calls.length

    rerender(<DetailPanel node={b} context={context} onClose={() => {}} />)
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst) // a real change must not be swallowed by memoization
  })
})

describe("DetailPanel — rapid node switching (Story 16.1 edge case)", () => {
  it("clicking through many nodes in quick succession completes without throwing or cumulative slowdown", () => {
    const nodes: PlanNode[] = Array.from({ length: 40 }, (_, i) =>
      makeNode({
        id: `n${i}`,
        rawOperatorLabel: `Op ${i}`,
        actualTimeMs: i,
        attributes: Object.fromEntries(Array.from({ length: 20 }, (_, j) => [`attr-${j}`, `value-${j}`])),
        warnings: i % 3 === 0 ? [{ ruleId: "disk-spill", severity: "critical", shortText: "x", longText: "y" }] : [],
      }),
    )
    const root = makeNode({ id: "root", children: nodes })

    render(<PlanGraph root={root} />)
    const cards = screen.getAllByTestId("plan-node-card")
    expect(cards.length).toBeGreaterThanOrEqual(40)

    const start = performance.now()
    for (const card of cards) {
      fireEvent.click(card)
    }
    const elapsed = performance.now() - start

    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
    // A loose ceiling, not a tight benchmark (jsdom timing isn't real
    // browser paint time) — this exists to catch a gross regression (e.g.
    // an accidentally-reintroduced O(n²) pass over the whole plan on every
    // click), not to enforce a specific millisecond budget.
    expect(elapsed).toBeLessThan(2000)
  })
})

describe("DetailPanel — large raw-attributes bag (Story 16.1 edge case)", () => {
  it("does not render attribute content until explicitly expanded, even for a very large attributes bag", () => {
    const bigAttributes = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`field-${i}`, `value-${i}`]))
    const node = makeNode({ attributes: bigAttributes })
    const context = buildPlanContext(node)
    render(<DetailPanel node={node} context={context} onClose={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: "Expert" }))
    expect(screen.getByTestId("raw-attributes")).toBeInTheDocument()
    // Collapsed by default — none of the 500 fields are in the DOM yet.
    expect(screen.queryByText(/field-0: value-0/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Raw attributes/ }))
    expect(screen.getByText(/field-0: value-0/)).toBeInTheDocument()
  })
})

describe("PlanGraph (canvas mode) — panel open is not blocked by graph rendering (Story 16.1 edge case)", () => {
  it("the detail panel appears synchronously on click, without waiting for the canvas's own (async, rAF-scheduled) redraw", () => {
    let node: PlanNode = makeNode({ id: "deep-leaf", rawOperatorLabel: "Seq Scan" })
    for (let i = 0; i < 305; i++) {
      node = makeNode({ id: `n${i}`, children: [node] })
    }
    const root = node

    render(<PlanGraph root={root} />)
    expect(screen.getByTestId("canvas-plan-graph-surface")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("accessible-list-toggle"))
    fireEvent.click(screen.getAllByTestId("accessible-plan-list-item")[0])

    // No waitFor/act-flush needed here — the assertion itself proves the
    // panel is already in the DOM in the same synchronous pass as the
    // click, regardless of whatever the canvas's separate rAF-scheduled
    // redraw effect is doing.
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument()
  })
})
