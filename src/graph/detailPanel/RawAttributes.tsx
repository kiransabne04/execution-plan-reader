import { memo, useMemo, useState } from "react"
import type { PlanNode } from "../../parsers/normalize"

export interface RawAttributesProps {
  attributes: PlanNode["attributes"]
  expertMode: boolean
}

/**
 * Panel section 8 — the untouched attributes bag, collapsed by default and
 * only shown at all in Expert mode. The escape hatch for anyone who wants
 * to see exactly what the engine reported with nothing normalized away.
 *
 * Story 16.1's edge case: "a node with an unusually large raw attributes
 * bag could make this section the slow part." This was already lazy
 * (collapsed by default, content only rendered after an explicit click —
 * see the `expanded` gate below) before this story; `Object.entries` and
 * the joined-string formatting are additionally memoized on `attributes`
 * identity so re-expanding the same node's attributes twice doesn't
 * re-derive the formatted text either.
 */
function RawAttributesInner({ attributes, expertMode }: RawAttributesProps) {
  const [expanded, setExpanded] = useState(false)
  // Hooks run unconditionally (both early returns below happen after) —
  // cheap regardless (Object.entries/join over one node's own attributes
  // bag, not the whole plan), but this is the one section explicitly named
  // as a possible bottleneck in Story 16.1's edge-case table, so it gets
  // memoized on the same basis as the other sections rather than assumed
  // fine because it's currently fine.
  const entries = useMemo(() => Object.entries(attributes), [attributes])
  const formatted = useMemo(() => entries.map(([key, value]) => `${key}: ${value}`).join("\n"), [entries])

  if (!expertMode) return null
  if (entries.length === 0) return null

  return (
    <section className="detail-panel__section" data-testid="raw-attributes">
      <button
        type="button"
        className="detail-panel__section-heading"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        Raw attributes {expanded ? "▾" : "▸"}
      </button>
      {expanded && <pre className="detail-panel__raw-attributes">{formatted}</pre>}
    </section>
  )
}

export const RawAttributes = memo(RawAttributesInner)
