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

import { useEffect, useRef, type ReactNode } from "react"
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

  // Episode 26, Story 26.2 — click ANYWHERE outside the rail/panel closes
  // it now, not just its own close button or a same-icon re-click (Story
  // 6.3's original behavior, still intact via `toggle`/`closePanel` above).
  // A plain `document` listener, not `stopPropagation`-guarded — the AC's
  // own explicit requirement is that the click ALSO still does whatever it
  // landed on (e.g. selecting a node behind the now-non-interactive scrim
  // below), not just close this panel. Attached only while a panel is
  // actually open, so this never costs anything the rest of the time.
  // Listening on the bubble phase (the default) means the click's own
  // target handler already ran by the time this fires — closing never
  // races or preempts it.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!activePanel) return
    const handleDocumentClick = (event: MouseEvent) => {
      // `event.composedPath()`, not `navRef.current.contains(event.target)`
      // — a real bug found via e2e: a click that causes ITS OWN target to
      // unmount as a side effect (e.g. PasteBox.tsx's "pasted · N lines"
      // summary button, which disappears the instant it's clicked, right
      // before this listener runs) leaves `event.target` detached from the
      // document by the time this fires; `contains()` on a detached node
      // always reports `false`, misreading a genuinely-inside click as
      // outside and closing the panel out from under the very content it
      // just revealed. `composedPath()` is captured at DISPATCH time,
      // before any handler (including React's own state update) can mutate
      // the tree, so it still reflects the real ancestry regardless of what
      // happens to the target afterward.
      if (navRef.current && !event.composedPath().includes(navRef.current)) closePanel()
    }
    document.addEventListener("click", handleDocumentClick)
    return () => document.removeEventListener("click", handleDocumentClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel])

  return (
    <nav className="icon-rail" data-testid="icon-rail" aria-label="Plan input and recent plans" ref={navRef}>
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

      {/* Purely a visual dim now (Story 26.2) — `pointer-events: none` in
          CSS, no `onClick` of its own: the document-level listener above
          is what actually closes the panel on an outside click, and it
          needs that click to reach its REAL target underneath (e.g.
          selecting a canvas node), not be swallowed here the way Story
          6.3's original click-to-close scrim did. `hidden` (a real bug
          Story 6.3's own e2e run caught), not conditional unmounting:
          PasteBox owns its own pasted-text state internally (`useState`,
          no controlled prop from here) — closing this panel by
          UNMOUNTING it would wipe whatever was typed/pasted, breaking the
          "re-openable, to edit and re-analyze" requirement once a plan
          had already been analyzed once. `hidden` keeps both content
          subtrees permanently mounted (matching PasteBox's own
          established "CSS-only visibility toggle, not a conditional
          unmount" pattern for its internal collapse), only ever swapping
          which one is visible. */}
      <div className="icon-rail__scrim" data-testid="icon-rail-scrim" hidden={!activePanel} />
      <div
        className="icon-rail__panel"
        role="dialog"
        aria-label={activePanel === "recent-plans" ? "Recent plans" : "Plan input"}
        data-testid="icon-rail-panel"
        hidden={!activePanel}
      >
        <button type="button" className="icon-rail__panel-close" aria-label="Close" data-testid="icon-rail-panel-close" onClick={closePanel}>
          ×
        </button>
        <div hidden={activePanel !== "new-plan"}>{newPlanContent}</div>
        <div hidden={activePanel !== "recent-plans"}>{recentPlansContent}</div>
      </div>
    </nav>
  )
}
