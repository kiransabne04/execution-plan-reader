// Story 6.3 — the findings list moves from the old permanent left rail
// into a collapsible bottom drawer spanning the canvas column. Reuses
// `FindingsList`'s existing filtering/data logic entirely (its new
// `variant="compact"` — see that file) for the expanded body; this
// component only owns the collapsed one-line summary and the expand/
// collapse chrome/height.

import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react"
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
   * `collectFindingsAcrossStatements` call `IconRail`'s own Issues badge
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

// Episode 26, Story 26.3 — drag-resize, additive on top of the original
// fixed `min(38vh, 420px)` cap (still declared in planReaderPage.css):
// `customHeightPx === null` means "never touched, use that same
// viewport-responsive default unchanged" (no inline style at all, so the
// CSS rule governs exactly as it always has); dragging or using the arrow
// keys sets an explicit pixel override (inline style, which beats the CSS
// rule on specificity) clamped between a small usable floor and 80% of
// the drawer's own container height.
const MIN_HEIGHT_PX = 48
const MAX_HEIGHT_FRACTION_OF_CONTAINER = 0.8

export function FindingsDrawer({ sources, activeStatementIndex, onSelectNode, summary, isOpen, onOpenChange, detailPanelOpen }: FindingsDrawerProps) {
  // Session-only (component state, not persisted/lifted) — same scope
  // discipline Story 6.3 used for its own detail-panel pin preference.
  const [customHeightPx, setCustomHeightPx] = useState<number | null>(null)

  // A fresh analyze resets the height back to default — same "adjust
  // state during render, keyed on root object identity" pattern
  // FindingsList.tsx uses for its own filters, so switching statements or
  // reopening the SAME plan's drawer never loses a manually-chosen height,
  // but a genuinely new plan starts clean.
  const rootsKey = sources.map((s) => s.root)
  const [prevRoots, setPrevRoots] = useState(rootsKey)
  const rootsChanged = rootsKey.length !== prevRoots.length || rootsKey.some((r, i) => r !== prevRoots[i])
  if (rootsChanged) {
    setPrevRoots(rootsKey)
    setCustomHeightPx(null)
  }

  const drawerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)

  const getCurrentBodyHeight = () => drawerRef.current?.querySelector<HTMLElement>(".findings-drawer__body")?.getBoundingClientRect().height ?? MIN_HEIGHT_PX

  // Edge case: clamp to a sane min (roughly the collapsed summary's own
  // height — never so short it's unusable) and max (80% of the available
  // canvas-column height this drawer is a flex child within — never so
  // tall it swallows the whole canvas). `parentElement` is
  // `.plan-shell__canvas`'s own flex column; falling back to the viewport
  // height keeps this safe even if the drawer is ever used outside that
  // specific layout.
  const clampHeight = (rawHeight: number) => {
    const containerHeight = drawerRef.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight
    const maxHeight = Math.max(MIN_HEIGHT_PX, containerHeight * MAX_HEIGHT_FRACTION_OF_CONTAINER)
    return Math.min(maxHeight, Math.max(MIN_HEIGHT_PX, rawHeight))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: getCurrentBodyHeight() }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // The handle sits at the drawer's own top edge, above a bottom-docked
    // body — dragging UP (a smaller clientY) grows it, matching how a
    // real user would expect to "pull the drawer taller."
    const deltaY = drag.startY - event.clientY
    setCustomHeightPx(clampHeight(drag.startHeight + deltaY))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragState.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A modest keyboard-accessible step — dragging is the primary
    // interaction, this is a real, working fallback for anyone who can't
    // or doesn't want to use a pointer. Starts from the LIVE rendered
    // height (not an assumed default) so the first press never jumps.
    const step = 24
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setCustomHeightPx(clampHeight((customHeightPx ?? getCurrentBodyHeight()) + step))
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      setCustomHeightPx(clampHeight((customHeightPx ?? getCurrentBodyHeight()) - step))
    }
  }

  return (
    <div
      ref={drawerRef}
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
        <>
          {/* Episode 26, Story 26.3 — drag handle. A `role="separator"`
              slider is the correct ARIA shape for a draggable panel-size
              control; keyboard users get the same range via the arrow
              keys (`aria-valuenow` reflects the live height, matching
              this codebase's own `aria-valuenow` usage on the detail
              panel's contribution bar). */}
          <div
            className="findings-drawer__resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the Issues panel"
            aria-valuemin={MIN_HEIGHT_PX}
            aria-valuenow={Math.round(customHeightPx ?? getCurrentBodyHeight())}
            tabIndex={0}
            data-testid="findings-drawer-resize-handle"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
          />
          <div
            className="findings-drawer__body"
            data-testid="findings-drawer-body"
            style={customHeightPx !== null ? { maxHeight: `${customHeightPx}px` } : undefined}
          >
            <FindingsList sources={sources} activeStatementIndex={activeStatementIndex} onSelectNode={onSelectNode} variant="compact" />
          </div>
        </>
      )}
    </div>
  )
}
