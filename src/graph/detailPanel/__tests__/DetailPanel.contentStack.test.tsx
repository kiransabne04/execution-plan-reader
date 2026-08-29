import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Episode 18, Story 18.13's own edge case: with a matching post AND a
// real funnel-triggering warning both present on the same node, spec §5
// `2c`'s actual requirement is "kept visually apart... never stack the
// two adjacent" — NOT "never both visible" (an earlier, overstated
// paraphrase of this in this project's own episode-authored testing
// notes; the literal spec text is the authority here, same as every
// other episode-doc-vs-spec correction this session has made). Both CAN
// render for the same node; this test locks in that they're structurally
// separated, not visually stacked touching each other.
vi.mock("../../content/posts", () => ({
  POSTS: [
    {
      id: "seq-scan-post",
      kind: "blog" as const,
      title: "Reading sequential scans",
      url: "https://example.com/seq-scan",
      minutes: 4,
      operatorTypes: ["seq_scan"],
      ruleIds: [],
    },
  ],
}))

const { DetailPanel } = await import("../DetailPanel")
const { applyRules } = await import("../../../rules/index")
const { buildPlanContext } = await import("../../../rules/types")
const { makeNode } = await import("../../../rules/__tests__/testHelpers")

describe("DetailPanel — ContentStack placement relative to FunnelCallout (Episode 18, Story 18.13)", () => {
  it("both can render for the same node, but ContentStack is NOT the funnel callout's adjacent DOM sibling", () => {
    sessionStorage.clear() // FunnelCallout's dismissal is session-scoped
    const node = makeNode({ engine: "postgres", operatorType: "seq_scan", actualRows: 50_000, attributes: { "Relation Name": "events" } })
    const context = buildPlanContext(node)
    applyRules(node, context) // fires seq-scan-on-large-table -> WarningsSection's funnel callout

    const { container } = render(<DetailPanel node={node} context={context} onClose={() => {}} />)

    const callout = screen.getByTestId("funnel-callout")
    const contentStack = screen.getByTestId("content-stack")
    expect(callout).toBeInTheDocument()
    expect(contentStack).toBeInTheDocument()

    // Structural separation, measured at the panel's own top-level section
    // order (not just "not a direct sibling of the callout div itself,"
    // which is trivially true since the callout nests one level inside
    // its own WarningsSection wrapper) — real intervening sections
    // (Contribution, QueryCorrelation) sit between the warnings section
    // and ContentStack, not a "stacked adjacent" layout.
    const topLevelChildren = Array.from(container.querySelector(".detail-panel")!.children)
    const warningsSectionIndex = topLevelChildren.findIndex((el) => el.getAttribute("data-testid") === "warnings-section")
    const contentStackIndex = topLevelChildren.findIndex((el) => el.getAttribute("data-testid") === "content-stack")
    expect(warningsSectionIndex).toBeGreaterThanOrEqual(0)
    expect(contentStackIndex).toBeGreaterThan(warningsSectionIndex + 1) // at least one section in between
  })
})
