// Story 6.3 — the findings list moves from the old permanent left rail
// into a collapsible bottom drawer spanning the canvas column. Reuses
// `FindingsList`'s existing filtering/data logic entirely (its new
// `variant="compact"` — see that file) for the expanded body; this
// component only owns the collapsed one-line summary and the expand/
// collapse chrome/height cap.

import type { FindingsSource } from "../../rules/findings"
import { NO_ISSUES_TEXT } from "../../rules/summarize"
import { FindingsList } from "./FindingsList"
import "./findingsList.css"

export interface FindingsSummaryCounts {
  total: number
  critical: number
  warning: number
  info: number
}

export interface FindingsDrawerProps {
  sources: FindingsSource[]
  activeStatementIndex: number
  onSelectNode: (statementIndex: number, nodeId: string) => void
  /** Precomputed once by the caller (PlanReaderPage), the same
   * `collectFindingsAcrossStatements` call `IconRail`'s own Findings badge
   * reads — one aggregate, read twice, never two independently-computed
   * counts that could drift from each other. */
  summary: FindingsSummaryCounts
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Story 6.3's own edge case: an open, un-pinned detail panel (a fixed
   * overlay anchored to the viewport's right edge) and this drawer's
   * expanded body could otherwise visually collide in the bottom-right
   * corner. Insets the drawer's right edge by the detail panel's own
   * known width (`detailPanel.css`'s `min(420px, 100vw)`) while true. */
  detailPanelOpen: boolean
}

function summaryLine(summary: FindingsSummaryCounts): string {
  if (summary.total === 0) return NO_ISSUES_TEXT
  return `${summary.total} finding${summary.total === 1 ? "" : "s"} · ${summary.critical} critical · ${summary.warning} warning${summary.warning === 1 ? "" : "s"} · ${summary.info} info`
}

export function FindingsDrawer({ sources, activeStatementIndex, onSelectNode, summary, isOpen, onOpenChange, detailPanelOpen }: FindingsDrawerProps) {
  return (
    <div
      className={`findings-drawer${isOpen ? " findings-drawer--open" : ""}${detailPanelOpen ? " findings-drawer--inset" : ""}`}
      data-testid="findings-drawer"
    >
      <button
        type="button"
        className="findings-drawer__summary"
        aria-expanded={isOpen}
        data-testid="findings-drawer-summary"
        onClick={() => onOpenChange(!isOpen)}
      >
        {summaryLine(summary)}
      </button>

      {isOpen && (
        <div className="findings-drawer__body" data-testid="findings-drawer-body">
          <FindingsList sources={sources} activeStatementIndex={activeStatementIndex} onSelectNode={onSelectNode} variant="compact" />
        </div>
      )}
    </div>
  )
}
