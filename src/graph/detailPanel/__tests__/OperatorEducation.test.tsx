import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { OperatorEducation } from "../OperatorEducation"
import { makeNode } from "../../../rules/__tests__/testHelpers"

// jsdom never actually lays out CSS, so every element's real
// scrollHeight/clientHeight are both 0 — stubbing these two properties at
// the prototype level lets each test simulate the two real states
// `ExpandableEducationBody`'s layout effect distinguishes between
// (genuinely clamped-and-overflowing vs. genuinely fits). Set *before*
// `render()` so the effect reads the intended values on its very first
// (mount-time) run.
let mockScrollHeight = 60
let mockClientHeight = 60

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return mockScrollHeight
    },
  })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return mockClientHeight
    },
  })
})

beforeEach(() => {
  mockScrollHeight = 60
  mockClientHeight = 60
})

describe("OperatorEducation — Beginner mode: needed details first, then definition", () => {
  it("renders the whenItsFine/whenToLookCloser bullets BEFORE the long definition paragraph", () => {
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    const { container } = render(<OperatorEducation node={node} expertMode={false} />)
    const body = container.querySelector(".detail-panel__education-body") as HTMLElement
    const bullets = body.querySelector(".detail-panel__education-bullets") as HTMLElement
    const definition = body.querySelector(".detail-panel__education-text") as HTMLElement
    expect(bullets).toBeTruthy()
    expect(definition).toBeTruthy()
    // DOCUMENT_POSITION_FOLLOWING (4) means `definition` comes AFTER `bullets`.
    const position = bullets.compareDocumentPosition(definition)
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })
})

describe("OperatorEducation — Beginner mode whole-section Read more/Show less", () => {
  it("does not show a Read more link when the section's content fits within the clamp", () => {
    mockScrollHeight = 60
    mockClientHeight = 60
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    render(<OperatorEducation node={node} expertMode={false} />)
    expect(screen.queryByTestId("operator-education-readmore")).not.toBeInTheDocument()
  })

  it("shows a Read more link, styled as a link, when the section overflows the clamp — expanding reveals the bullets AND the full definition, and shows a Show less link", () => {
    mockScrollHeight = 400
    mockClientHeight = 120
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    const { container } = render(<OperatorEducation node={node} expertMode={false} />)

    expect(container.querySelector(".detail-panel__education-body--clamped")).toBeTruthy()
    // Both the bullets and the definition are inside the SAME collapsible
    // body — collapsing hides the whole section, not just the paragraph.
    expect(container.querySelector(".detail-panel__education-body--clamped .detail-panel__education-bullets")).toBeTruthy()
    expect(container.querySelector(".detail-panel__education-body--clamped .detail-panel__education-text")).toBeTruthy()

    const readMore = screen.getByTestId("operator-education-readmore")
    expect(readMore).toBeInTheDocument()
    expect(readMore.tagName).toBe("BUTTON")
    expect(readMore).toHaveTextContent("Read more")
    expect(readMore).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(readMore)

    expect(readMore).toHaveTextContent("Show less")
    expect(readMore).toHaveAttribute("aria-expanded", "true")
    expect(container.querySelector(".detail-panel__education-body--clamped")).not.toBeInTheDocument()

    fireEvent.click(readMore)
    expect(readMore).toHaveTextContent("Read more")
    expect(container.querySelector(".detail-panel__education-body--clamped")).toBeInTheDocument()
  })

  it("does not render the toggle at all in Expert mode (collapsed-disclosure path is separate)", () => {
    mockScrollHeight = 400
    mockClientHeight = 120
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    render(<OperatorEducation node={node} expertMode={true} />)
    expect(screen.queryByTestId("operator-education-readmore")).not.toBeInTheDocument()
  })
})
