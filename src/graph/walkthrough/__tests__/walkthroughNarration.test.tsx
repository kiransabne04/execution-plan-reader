import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { buildStepNarration } from "../walkthroughNarration"
import { OperatorEducation } from "../../detailPanel/OperatorEducation"
import { WarningsSection } from "../../detailPanel/WarningsSection"
import { makeNode } from "../../../rules/__tests__/testHelpers"
import { buildPlanContext } from "../../../rules/types"

describe("buildStepNarration", () => {
  it("Beginner mode reads the glossary's longDefinition (Story 18.7's field split)", () => {
    const node = makeNode({ id: "a", operatorType: "seq_scan", actualTimeMs: 10 })
    const narration = buildStepNarration(node, buildPlanContext(node), false)
    expect(narration.explanation.length).toBeGreaterThan(0)
    // Cross-checked against the real component below, not just non-empty.
  })

  it("Expert mode reads the glossary's shortDefinition, a different (shorter) string than Beginner's", () => {
    const node = makeNode({ id: "a", operatorType: "seq_scan", actualTimeMs: 10 })
    const beginner = buildStepNarration(node, buildPlanContext(node), false)
    const expert = buildStepNarration(node, buildPlanContext(node), true)
    expect(expert.explanation).not.toBe(beginner.explanation)
  })

  it("falls back to the glossary fallback message for an unmapped operatorType", () => {
    const node = makeNode({ id: "a", operatorType: "not_a_real_type", rawOperatorLabel: "Weird Op", actualTimeMs: 10 })
    const narration = buildStepNarration(node, buildPlanContext(node), false)
    expect(narration.explanation).toBe("We don't have a detailed explanation for this operator yet.")
    expect(narration.displayName).toBe("Weird Op")
  })

  // Story 20.6 — real bug found via manual testing: this is the ONE place
  // in the app that showed the glossary's generic, engine-agnostic
  // `displayName` ("Append") instead of the node's actual raw label
  // ("Concatenation", SQL Server's own term) — every other surface (graph
  // card, detail panel, findings list) only ever shows rawOperatorLabel.
  // An intern reading "Step 2: Append" then looking at a graph node
  // labeled "Concatenation" had no way to tell they're the same node.
  it("displayName is ALWAYS the raw label, never the glossary's generic cross-engine name, even when a glossary entry exists with a different displayName", () => {
    const node = makeNode({ id: "a", operatorType: "append", rawOperatorLabel: "Concatenation", actualTimeMs: 10 })
    const narration = buildStepNarration(node, buildPlanContext(node), false)
    expect(narration.displayName).toBe("Concatenation")
    expect(narration.displayName).not.toBe("Append") // the glossary's own displayName for "append" — must never leak in here
  })

  it("Beginner findings use shortText, Expert findings use longText — same inversion WarningsSection.tsx uses", () => {
    const node = makeNode({
      id: "a",
      actualTimeMs: 10,
      warnings: [{ ruleId: "disk-spill", severity: "critical", shortText: "short version", longText: "long version" }],
    })
    const context = buildPlanContext(node)
    expect(buildStepNarration(node, context, false).findings).toEqual(["short version"])
    expect(buildStepNarration(node, context, true).findings).toEqual(["long version"])
  })

  it("passes contributionPercent straight through from computeContributionPercent", () => {
    const root = makeNode({ id: "root", actualTimeMs: 10, children: [makeNode({ id: "a", actualTimeMs: 5 })] })
    const context = buildPlanContext(root)
    const child = root.children[0]
    const narration = buildStepNarration(child, context, false)
    expect(narration.contributionPercent).toBeCloseTo(50)
  })

  // The graph-visualization skill's explicit rule for this feature: "this
  // must never become a second content-authoring surface with its own
  // copy." This test is the regression guard — it renders the REAL
  // detail-panel components for the same node/mode and asserts the
  // walkthrough's narration strings are literally the same text, not a
  // parallel copy that happens to look similar today.
  describe("content-source regression guard against DetailPanel", () => {
    it.each([false, true])("explanation text matches OperatorEducation's rendered text, expertMode=%s", (expertMode) => {
      const node = makeNode({ id: "a", operatorType: "seq_scan", rawOperatorLabel: "Seq Scan", actualTimeMs: 10 })
      const narration = buildStepNarration(node, buildPlanContext(node), expertMode)

      render(<OperatorEducation operatorType={node.operatorType} rawOperatorLabel={node.rawOperatorLabel} expertMode={expertMode} />)
      const rendered = screen.getByTestId("operator-education-what").textContent
      expect(rendered).toContain(narration.explanation)
    })

    it.each([false, true])("finding text matches WarningsSection's rendered text, expertMode=%s", (expertMode) => {
      const warnings = [{ ruleId: "disk-spill", severity: "critical" as const, shortText: "short version", longText: "long version" }]
      const node = makeNode({ id: "a", actualTimeMs: 10, warnings })
      const narration = buildStepNarration(node, buildPlanContext(node), expertMode)

      render(<WarningsSection warnings={warnings} expertMode={expertMode} engine="postgres" />)
      const rendered = screen.getByTestId("warning-item").textContent
      expect(rendered).toContain(narration.findings[0])
    })
  })
})
