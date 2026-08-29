import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Story 18.13's own edge case: the real, shipped posts.ts must start
// empty. Mocked here with a controllable module so the component can
// still be tested against non-empty content without touching the real
// file (which vi.mock intercepts at the module-resolution level).
vi.mock("../posts", () => ({
  POSTS: [
    {
      id: "seq-scan-post",
      kind: "blog",
      title: "Why sequential scans aren't always bad",
      url: "https://example.com/seq-scan",
      minutes: 4,
      operatorTypes: ["seq_scan"],
      ruleIds: [],
    },
  ],
}))

const { ContentStack } = await import("../ContentStack")

describe("ContentStack", () => {
  it("renders a matching post as a new-tab, rel=noopener link", () => {
    render(<ContentStack operatorType="seq_scan" ruleIds={[]} />)

    const link = screen.getByTestId("content-stack-link")
    expect(link).toHaveAttribute("href", "https://example.com/seq-scan")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
    expect(link).toHaveTextContent("Why sequential scans aren't always bad")
  })

  it("renders nothing at all — not an empty container — when nothing matches", () => {
    render(<ContentStack operatorType="hash_join" ruleIds={["some-other-rule"]} />)
    expect(screen.queryByTestId("content-stack")).not.toBeInTheDocument()
  })

  it("fires zero network requests on render (no click-tracking beacon, no fetch)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    render(<ContentStack operatorType="seq_scan" ruleIds={[]} />)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
