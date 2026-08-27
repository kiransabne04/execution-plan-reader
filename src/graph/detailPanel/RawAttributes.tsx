import { useState } from "react"
import type { PlanNode } from "../../parsers/normalize"

export interface RawAttributesProps {
  attributes: PlanNode["attributes"]
  expertMode: boolean
}

/** Panel section 8 — the untouched attributes bag, collapsed by default and
 * only shown at all in Expert mode. The escape hatch for anyone who wants
 * to see exactly what the engine reported with nothing normalized away. */
export function RawAttributes({ attributes, expertMode }: RawAttributesProps) {
  const [expanded, setExpanded] = useState(false)
  if (!expertMode) return null

  const entries = Object.entries(attributes)
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
      {expanded && (
        <pre className="detail-panel__raw-attributes">
          {entries.map(([key, value]) => `${key}: ${value}`).join("\n")}
        </pre>
      )}
    </section>
  )
}
