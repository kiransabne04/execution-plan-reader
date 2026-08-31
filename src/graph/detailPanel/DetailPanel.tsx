import { useEffect, useMemo, useRef, useState } from "react"
import type { PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { computeContributionPercent } from "./computeContributionPercent"
import { ContentStack } from "../content/ContentStack"
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
  /** Story 18.2 — "overlay" (default) is the original always-fixed
   * behavior every existing caller (including PlanGraph's own internal
   * render, and each PlanComparisonView pane) still gets unchanged.
   * "shell" is for the app shell's right rail specifically: a normal
   * grid-track element above 1180px, falling back to the same fixed-
   * overlay-with-scrim behavior below it — see detailPanel.css's
   * `--in-shell` rules and docs/12-ui-redesign-spec.md §2's breakpoint
   * table. */
  variant?: "overlay" | "shell"
  /** Story 18.3 — lifts Beginner/Expert to page-level state (the app
   * bar's segmented control, shared with Story 18.9's walkthrough) so it
   * doesn't reset every time a different node is opened. Both omitted:
   * the original self-contained behavior, for every caller with no
   * page-level toggle to share — PlanGraph's own internal render, and
   * each PlanComparisonView pane (no app bar wraps those). Passing one
   * without the other is a caller bug (a controlled toggle needs a way to
   * change), not a supported half-controlled state. */
  expertMode?: boolean
  onExpertModeChange?: (expertMode: boolean) => void
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
export function DetailPanel({
  node,
  context,
  onClose,
  variant = "overlay",
  expertMode: controlledExpertMode,
  onExpertModeChange,
}: DetailPanelProps) {
  // Uncontrolled fallback for callers with no page-level state to lift
  // from (see the prop's own doc comment) — this is exactly the local
  // state this component used unconditionally before Story 18.3.
  const [uncontrolledExpertMode, setUncontrolledExpertMode] = useState(false)
  const expertMode = controlledExpertMode ?? uncontrolledExpertMode
  const setExpertMode = onExpertModeChange ?? setUncontrolledExpertMode
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Move focus into the panel whenever it opens (or the selected node
  // changes, since PlanGraph re-renders this same instance rather than
  // remounting it on every click — the accessibility acceptance criterion
  // is about a focused node's Enter/Space actually landing focus somewhere
  // sensible, not staying on a card that no longer represents what's shown).
  // Restoring focus back to whatever triggered the open is PlanGraph's job
  // (it's the one that knows which element that was); this panel doesn't
  // implement a hard Tab-trap — Tab continues past its own controls
  // normally, since it's a persistent side panel, not a full-screen modal.
  // Story 20.2: `{ preventScroll: true }` — same reasoning as
  // PlanNodeCard's own click handler. The panel opening is already what
  // brought it on-screen; moving focus into it shouldn't independently
  // re-trigger a scroll of the outer page.
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true })
  }, [node.id])

  // Story 16.1: memoized alongside the other per-node computations this
  // story names explicitly (glossary lookup, warning retrieval, this
  // percentage) — cheap arithmetic either way, but skips re-running when
  // DetailPanel re-renders for a reason unrelated to `node`/`context`
  // (e.g. the Beginner/Expert toggle, which this value doesn't depend on).
  const contributionPercent = useMemo(() => computeContributionPercent(node, context), [node, context])

  return (
    <div
      className={variant === "shell" ? "detail-panel detail-panel--in-shell" : "detail-panel"}
      role="dialog"
      aria-label={`Details for ${node.rawOperatorLabel}`}
      data-testid="detail-panel"
    >
      <button
        ref={closeButtonRef}
        type="button"
        className="detail-panel__close"
        onClick={onClose}
        aria-label="Close details"
      >
        ×
      </button>

      <header className="detail-panel__header">
        <p className="detail-panel__display-name" data-testid="detail-panel-display-name">
          {node.rawOperatorLabel}
          <span className="detail-panel__engine-badge">{ENGINE_LABEL[node.engine]}</span>
        </p>
        {/* Design review (reference mock) — the raw operator type PLUS this
            node's own id ("hash_join · node n3"), not the operator type
            alone; `node.id` disambiguates which of several same-type
            operators a click opened, useful once a plan has more than one
            Seq Scan or Hash Join. */}
        <p className="detail-panel__raw-label">
          {node.operatorType} · node {node.id}
        </p>
      </header>

      {/* Design review (reference mock) — the mock's right rail has no
          Beginner/Expert toggle of its own, only the app bar's; that
          toggle is what `variant === "shell"` means here (see this prop's
          own doc comment) — every OTHER caller (PlanGraph's own default
          overlay render, each PlanComparisonView pane) has no app-bar
          equivalent to defer to, so they keep this control exactly as
          before. */}
      {variant !== "shell" && (
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
      )}

      <OperatorEducation operatorType={node.operatorType} rawOperatorLabel={node.rawOperatorLabel} expertMode={expertMode} />
      <StatsTable node={node} expertMode={expertMode} />
      <WarningsSection warnings={node.warnings} expertMode={expertMode} engine={node.engine} />

      <section className="detail-panel__section" data-testid="contribution-summary">
        <h3 className="detail-panel__section-heading">Contribution to the plan</h3>
        {contributionPercent !== undefined ? (
          <div className="detail-panel__contribution-bar" data-testid="contribution-bar">
            <div
              className="detail-panel__contribution-bar-track"
              role="progressbar"
              aria-valuenow={Math.round(contributionPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Contribution to the plan's total cost/time"
            >
              <div
                className="detail-panel__contribution-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, contributionPercent))}%` }}
              />
            </div>
            <span className="detail-panel__contribution-value">{contributionPercent.toFixed(1)}%</span>
          </div>
        ) : (
          <p className="detail-panel__stat-gap">Not available for this plan.</p>
        )}
      </section>

      <QueryCorrelation queryText={context.statementText} queryTextRedacted={context.queryTextRedacted} />
      {/* Story 18.13, spec §5 `2c`: "never stack the two [this and the
          funnel callout] adjacent" — placed here, several sections away
          from WarningsSection (where FunnelCallout renders), by
          construction, not just visual styling. */}
      <ContentStack operatorType={node.operatorType} ruleIds={node.warnings.map((w) => w.ruleId)} />
      <RawAttributes attributes={node.attributes} expertMode={expertMode} />
    </div>
  )
}
