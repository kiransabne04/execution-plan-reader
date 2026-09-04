// Story 6.3 — replaces the old permanently-open left rail (Plan input
// stacked over Findings, both always visible) with a narrow icon rail once
// a plan has been analyzed. Two of its three icons (New plan, Recent
// plans) open a scrim-backed overlay panel next to the rail — the exact
// same "position: fixed panel + click-outside scrim" mechanism
// DetailPanel/its scrim already use, not a second, independently-built
// overlay pattern. The third (Findings) doesn't open an overlay here at
// all — it toggles the bottom findings drawer (see FindingsDrawer.tsx);
// this component only renders its badge and forwards the click.
//
// This component is intentionally "dumb" about content: PlanReaderPage
// still owns and renders the actual New Plan / Recent Plans JSX (PasteBox,
// RestoreSessionBanner, RecentPlansList, error notices) exactly as it did
// in the old always-visible rail — it's only handed in as `newPlanContent`/
// `recentPlansContent` and wrapped in this component's overlay chrome, so
// no business logic moves, only where it's displayed.

import type { ReactNode } from "react"
import { FilePlus, ClockCounterClockwise, ListChecks } from "@phosphor-icons/react"
import type { Warning } from "../parsers/normalize"

export type IconRailPanel = "new-plan" | "recent-plans" | null

export interface IconRailProps {
  activePanel: IconRailPanel
  onSelectPanel: (panel: IconRailPanel) => void
  newPlanContent: ReactNode
  recentPlansContent: ReactNode
  recentPlansCount: number
  findingsCount: number
  /** `undefined` when there are no findings at all — the badge doesn't
   * render rather than showing a zero/neutral dot for "nothing to see." */
  findingsWorstSeverity: Warning["severity"] | undefined
  isFindingsOpen: boolean
  onToggleFindings: () => void
}

export function IconRail({
  activePanel,
  onSelectPanel,
  newPlanContent,
  recentPlansContent,
  recentPlansCount,
  findingsCount,
  findingsWorstSeverity,
  isFindingsOpen,
  onToggleFindings,
}: IconRailProps) {
  const closePanel = () => onSelectPanel(null)
  const toggle = (panel: Exclude<IconRailPanel, null>) => onSelectPanel(activePanel === panel ? null : panel)

  return (
    <nav className="icon-rail" data-testid="icon-rail" aria-label="Plan input and recent plans">
      <button
        type="button"
        className="icon-rail__button"
        aria-pressed={activePanel === "new-plan"}
        aria-label="New plan"
        title="New plan"
        data-testid="icon-rail-new-plan"
        onClick={() => toggle("new-plan")}
      >
        <FilePlus weight={activePanel === "new-plan" ? "fill" : "regular"} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="icon-rail__button"
        aria-pressed={activePanel === "recent-plans"}
        aria-label={`Recent plans${recentPlansCount > 0 ? ` (${recentPlansCount})` : ""}`}
        title="Recent plans"
        data-testid="icon-rail-recent-plans"
        onClick={() => toggle("recent-plans")}
      >
        <ClockCounterClockwise weight={activePanel === "recent-plans" ? "fill" : "regular"} aria-hidden="true" />
        {recentPlansCount > 0 && (
          <span className="icon-rail__badge icon-rail__badge--neutral" data-testid="icon-rail-recent-plans-badge">
            {recentPlansCount > 99 ? "99+" : recentPlansCount}
          </span>
        )}
      </button>

      <button
        type="button"
        className="icon-rail__button"
        aria-pressed={isFindingsOpen}
        aria-label={`Findings${findingsCount > 0 ? ` (${findingsCount})` : ""}`}
        title="Findings"
        data-testid="icon-rail-findings"
        onClick={onToggleFindings}
      >
        <ListChecks weight={isFindingsOpen ? "fill" : "regular"} aria-hidden="true" />
        {findingsWorstSeverity && (
          <span
            className={`icon-rail__badge icon-rail__badge--${findingsWorstSeverity}`}
            data-testid="icon-rail-findings-badge"
          >
            {findingsCount > 99 ? "99+" : findingsCount}
          </span>
        )}
      </button>

      {activePanel && (
        <>
          {/* Same fixed-scrim-behind-a-fixed-panel mechanism as the detail
              panel's own overlay (planReaderPage.css's
              .plan-shell__detail-scrim) — one overlay pattern in this app. */}
          <div className="icon-rail__scrim" data-testid="icon-rail-scrim" onClick={closePanel} />
          <div className="icon-rail__panel" role="dialog" aria-label={activePanel === "new-plan" ? "Plan input" : "Recent plans"} data-testid="icon-rail-panel">
            <button type="button" className="icon-rail__panel-close" aria-label="Close" data-testid="icon-rail-panel-close" onClick={closePanel}>
              ×
            </button>
            {activePanel === "new-plan" ? newPlanContent : recentPlansContent}
          </div>
        </>
      )}
    </nav>
  )
}
