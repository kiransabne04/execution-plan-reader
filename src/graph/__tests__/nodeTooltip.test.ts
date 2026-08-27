import { describe, expect, it } from "vitest"
import { buildNodeTooltip } from "../nodeTooltip"
import { makeNode } from "../../rules/__tests__/testHelpers"

describe("buildNodeTooltip", () => {
  it("returns undefined when the node has no predicate/seek/join condition", () => {
    expect(buildNodeTooltip(makeNode({}))).toBeUndefined()
  })

  it("formats a filter condition", () => {
    const node = makeNode({ predicate: { filter: "[Status]='active'" } })
    expect(buildNodeTooltip(node)).toBe("Filter: [Status]='active'")
  })

  it("formats a seek (index) condition, including a composite multi-column one", () => {
    const node = makeNode({ predicate: { indexCondition: "[CustomerId]=(42) AND [OrderDate]=('2024-01-01')" } })
    expect(buildNodeTooltip(node)).toBe("Seek: [CustomerId]=(42) AND [OrderDate]=('2024-01-01')")
  })

  it("formats a join condition", () => {
    const node = makeNode({ predicate: { joinCondition: "[a.id]=[b.id]" } })
    expect(buildNodeTooltip(node)).toBe("Join: [a.id]=[b.id]")
  })

  it("combines all three, each on its own line, when more than one is present", () => {
    const node = makeNode({
      predicate: { filter: "F", indexCondition: "S", joinCondition: "J" },
    })
    expect(buildNodeTooltip(node)).toBe("Filter: F\nSeek: S\nJoin: J")
  })
})
