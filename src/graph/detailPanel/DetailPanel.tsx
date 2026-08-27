import { useEffect, useState } from "react"
import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { computeContributionPercent } from "./computeContributionPercent"
import { OperatorEducation } from "./OperatorEducation"
import { QueryCorrelation } from "./QueryCorrelation"
import { RawAttributes } from "./RawAttributes"
import { StatsTable } from "./StatsTable"
import { WarningsSection } from "./WarningsSection"
import "./detailPanel.css"

export interface DetailPanelProps {
  node: PlanNode
  context: PlanContext
  onClose: () => void
}

const ENGINE_LABEL: Record<PlanNode["engine"], string> = {
  postgres: "Postgres",
  sqlserver: "SQL Server",
  snowflake: "Snowflake",
}

/**
 * Story 6.2 — the rich node detail panel. Content is cheap to swap between
 * nodes (everything here derives from already-computed PlanNode/Warning[]
 * data — no re-computation of layout or re-fetch of glossary content per
 * click, satisfying the "rapid clicking across many nodes" edge case for
 * free, since glossary lookup is an O(1) map read).
 */
export function DetailPanel({ node, context, onClose }: DetailPanelProps) {
  // Local to the panel for now — a future global Beginner/Expert toggle
  // (technical spec §3.1) could lift this state up; scoped here since it's
  // this story's own concern (which text field to show, what's expanded by
  // default) and nothing today needs it to be shared app-wide.
  const [expertMode, setExpertMode] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const contributionPercent = computeContributionPercent(node, context)

  return (
    <div className="detail-panel" role="dialog" aria-label={`Details for ${node.rawOperatorLabel}`} data-testid="detail-panel">
      <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close details">
        ×
      </button>

      <header className="detail-panel__header">
        <p className="detail-panel__display-name" data-testid="detail-panel-display-name">
          {node.rawOperatorLabel}
          <span className="detail-panel__engine-badge">{ENGINE_LABEL[node.engine]}</span>
        </p>
        <p className="detail-panel__raw-label">{node.operatorType}</p>
      </header>

      <div className="detail-panel__mode-toggle" role="group" aria-label="Detail level">
        <button
          type="button"
          className="detail-panel__mode-button"
          aria-pressed={!expertMode}
          onClick={() => setExpertMode(false)}
        >
          Beginner
        </button>
        <button
          type="button"
          className="detail-panel__mode-button"
          aria-pressed={expertMode}
          onClick={() => setExpertMode(true)}
        >
          Expert
        </button>
      </div>

      <OperatorEducation operatorType={node.operatorType} rawOperatorLabel={node.rawOperatorLabel} expertMode={expertMode} />
      <StatsTable node={node} />
      <WarningsSection warnings={node.warnings} expertMode={expertMode} />

      <section className="detail-panel__section" data-testid="contribution-summary">
        <h3 className="detail-panel__section-heading">Contribution to the plan</h3>
        {contributionPercent !== undefined ? (
          <p>{contributionPercent.toFixed(1)}% of the plan's total cost/time.</p>
        ) : (
          <p className="detail-panel__stat-gap">Not available for this plan.</p>
        )}
      </section>

      <QueryCorrelation queryText={context.statementText} queryTextRedacted={context.queryTextRedacted} />
      <RawAttributes attributes={node.attributes} expertMode={expertMode} />
    </div>
  )
}
