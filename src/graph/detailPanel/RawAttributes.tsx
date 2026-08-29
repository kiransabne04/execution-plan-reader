import { memo, useMemo, useState } from "react"
import type { PlanNode } from "../../parsers/normalize"

export interface RawAttributesProps {
  attributes: PlanNode["attributes"]
  expertMode: boolean
}

/**
 * Panel section 8 — the untouched attributes bag, only shown at all in
 * Expert mode (never in Beginner). The escape hatch for anyone who wants
 * to see exactly what the engine reported with nothing normalized away.
 *
 * Story 18.7 (spec §5 `1f`): expanded by default on entering Expert mode
 * — still collapsible by hand afterward, see the `expanded` state/effect
 * above. Before that story this was collapsed by default even in Expert
 * mode (Story 16.1's original choice, driven by its own 500-field
 * performance edge case); `Object.entries`/the joined-string formatting
 * stay memoized on `attributes` identity regardless, which is what keeps
 * expanding-by-default cheap even for a large bag — see Story 18.7's own
 * edge-case note on confirming this doesn't reintroduce that regression.
 */
function RawAttributesInner({ attributes, expertMode }: RawAttributesProps) {
  const [expanded, setExpanded] = useState(expertMode)

  // Story 18.7, spec §5 `1f`: Expert mode's raw attributes are "expanded"
  // (Beginner's is "hidden" — this section isn't even rendered there, see
  // the early return below). React's documented "adjust state during
  // render" pattern (same one PlanGraph.tsx already uses for its own
  // prop-change resets) rather than a useEffect — reacts the moment
  // `expertMode` itself CHANGES, without the extra render-then-effect
  // round trip, and without fighting a user who manually collapses it
  // while STAYING in Expert mode (this only fires again once `expertMode`
  // actually flips, not on every unrelated re-render).
  const [prevExpertMode, setPrevExpertMode] = useState(expertMode)
  if (expertMode !== prevExpertMode) {
    setPrevExpertMode(expertMode)
    if (expertMode) setExpanded(true)
  }
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
