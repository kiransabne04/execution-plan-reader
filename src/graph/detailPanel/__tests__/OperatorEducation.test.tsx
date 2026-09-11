import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { OperatorEducation } from "../OperatorEducation"
import { makeNode } from "../../../rules/__tests__/testHelpers"

// jsdom never actually lays out CSS (`-webkit-line-clamp` included), so
// every element's real scrollHeight/clientHeight are both 0 — stubbing
// these two properties at the prototype level lets each test simulate the
// two real states `ExpandableLongDefinition`'s layout effect distinguishes
// between (genuinely clamped-and-overflowing vs. genuinely fits). Set
// *before* `render()` so the effect reads the intended values on its very
// first (mount-time) run — a post-render mutation wouldn't retrigger the
// effect, since its own dependency array only reacts to `text`/`expanded`
// changing, not a DOM property changing out from under it.
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

describe("OperatorEducation — Beginner mode long-definition Read more/Show less", () => {
  it("does not show a Read more link when the text fits within the clamp", () => {
    mockScrollHeight = 60
    mockClientHeight = 60
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    render(<OperatorEducation node={node} expertMode={false} />)
    expect(screen.queryByTestId("operator-education-readmore")).not.toBeInTheDocument()
  })

  it("shows a Read more link, styled as a link, when the text overflows the 6-line clamp — expanding reveals the full text and shows a Show less link", () => {
    mockScrollHeight = 400
    mockClientHeight = 120
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    const { container } = render(<OperatorEducation node={node} expertMode={false} />)

    expect(container.querySelector(".detail-panel__education-text--clamped")).toBeTruthy()

    const readMore = screen.getByTestId("operator-education-readmore")
    expect(readMore).toBeInTheDocument()
    expect(readMore.tagName).toBe("BUTTON")
    expect(readMore).toHaveTextContent("Read more")
    expect(readMore).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(readMore)

    expect(readMore).toHaveTextContent("Show less")
    expect(readMore).toHaveAttribute("aria-expanded", "true")
    expect(container.querySelector(".detail-panel__education-text--clamped")).not.toBeInTheDocument()

    fireEvent.click(readMore)
    expect(readMore).toHaveTextContent("Read more")
    expect(container.querySelector(".detail-panel__education-text--clamped")).toBeInTheDocument()
  })

  it("does not render the toggle at all in Expert mode (collapsed-disclosure path is separate)", () => {
    mockScrollHeight = 400
    mockClientHeight = 120
    const node = makeNode({ engine: "postgres", operatorType: "hash_join" })
    render(<OperatorEducation node={node} expertMode={true} />)
    expect(screen.queryByTestId("operator-education-readmore")).not.toBeInTheDocument()
  })
})
