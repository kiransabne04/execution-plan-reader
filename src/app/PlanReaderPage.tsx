import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { DownloadSimple, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react"
import { PasteBox } from "./PasteBox"
import { Notice } from "./Notice"
import { ComparePasteBox } from "./ComparePasteBox"
import { ShareLinkButton } from "./ShareLinkButton"
import { RestoreSessionBanner } from "./RestoreSessionBanner"
import { RecentPlansList } from "./RecentPlansList"
import { analyzePlanText, type AnalyzedPlan } from "./analyzePlan"
import { formatStatementDuration, statementSeverity } from "./statementTabSummary"
import { decodeShareLink } from "./shareLink"
// Episode 19: the hero landing page this copy served is retired — the
// three-column shell is now the app's only page, from first load, per the
// user-supplied mockup screenshot. positioningCopy.ts's exports stay in
// place (Story 8.1's brief-matching requirement is still true of the
// source file itself) for a future first-time-visitor-credibility pass to
// start from, just unused here today. See docs/08-episodes-and-stories.md's
// Episode 19 header for the full account of what this supersedes.
import { PlanGraph, FindingsList, PlanComparisonView, DetailPanel, SearchPalette, WalkthroughOverlay, SEVERITY_LABEL, type PlanGraphHandle } from "../graph"
import { PlanParseError, collectNodes, type PlanNode } from "../parsers/normalize"
import type { PlanContext } from "../rules/types"
import { formatNumber } from "../rules/format"
import { OPENERS } from "../rules/summarize"
import {
  saveSession,
  loadSession,
  clearSession,
  addRecentPlan,
  listRecentPlans,
  deleteRecentPlan,
  clearAllRecentPlans,
  debounce,
  type RecentPlanEntry,
} from "../persistence"
import "./planReaderPage.css"

// Episode 17, Story 17.1: "saved to browser storage automatically,
// debounced rather than on every keystroke." handleAnalyze already only
// ever fires on an explicit paste-and-click (never per keystroke), so this
// mainly guards against back-to-back rapid re-analyzes hammering IndexedDB.
// Exported so tests can wait out exactly this window rather than a guessed
// magic number.
export const SESSION_SAVE_DEBOUNCE_MS = 500

const ENGINE_LABEL: Record<AnalyzedPlan["engine"], string> = {
  postgres: "Postgres",
  sqlserver: "SQL Server",
  snowflake: "Snowflake",
}

interface InitialState {
  rawText: string
  analyzed: AnalyzedPlan | null
  error: string | null
}

/** Story 11.2: a shareable link's fragment is decoded and re-parsed
 * synchronously on first render (no loading gate, no async round trip —
 * decoding/parsing is entirely local) so the very first paint already
 * shows the recovered plan, exactly like a normal paste would. Returns
 * `null` when there's no fragment at all — the ordinary "fresh visit" case,
 * not an error. */
function loadFromLocationHash(): InitialState | null {
  const hash = window.location.hash.slice(1)
  if (!hash) return null

  const decoded = decodeShareLink(hash)
  if (!decoded.ok) {
    const message =
      decoded.reason === "unsupported_version"
        ? "This link was created by a different version of PlanReader and can't be opened here."
        : "This link looks incomplete or corrupted — it may have been cut off when it was shared."
    return { rawText: "", analyzed: null, error: message }
  }

  try {
    return { rawText: decoded.text, analyzed: analyzePlanText(decoded.text), error: null }
  } catch (err) {
    // The link decoded fine, but the recovered text itself doesn't parse —
    // treat exactly like a normal paste failure, not a share-link-specific
    // one, since that's genuinely what's happened by this point.
    return {
      rawText: decoded.text,
      analyzed: null,
      error: err instanceof PlanParseError ? err.message : "Something went wrong reading this plan.",
    }
  }
}

export function PlanReaderPage() {
  const [initial] = useState(loadFromLocationHash)
  const [analyzed, setAnalyzed] = useState<AnalyzedPlan | null>(initial?.analyzed ?? null)
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [rawText, setRawText] = useState(initial?.rawText ?? "")
  const [activeStatementIndex, setActiveStatementIndex] = useState(0)
  // Story 13.1: which node the "All findings" list most recently asked the
  // graph to navigate to and open. Lives here (not inside PlanGraph or
  // FindingsList) since it's the thing connecting those two otherwise-
  // independent components.
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(undefined)

  // Episode 18, Story 18.8 — search/filter palette. `matchedNodeIds` feeds
  // straight into PlanGraph's own prop of the same name; `undefined` means
  // "no active search," matching searchNodes.ts's `isActive` semantics.
  const [isSearchPaletteOpen, setIsSearchPaletteOpen] = useState(false)
  const [matchedNodeIds, setMatchedNodeIds] = useState<Set<string> | undefined>(undefined)

  // Episode 18, Story 18.9 — guided walkthrough.
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState(false)

  // Episode 18, Story 18.11 — PNG export. A ref, not lifted state: the
  // export button lives in the app bar, outside PlanGraph, and has no
  // reason to know about PlanGraph's own internal collapsedIds/DOM-vs-
  // canvas-mode state — see PlanGraphHandle's own doc comment.
  const planGraphRef = useRef<PlanGraphHandle>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // Episode 18, Story 18.2 — the app shell's right rail: PlanGraph reports
  // the currently-open node's panel contents here instead of rendering
  // `<DetailPanel>` itself (see PlanGraph.tsx's `externalDetailPanel`),
  // since a true grid-track panel has to be a sibling of the rails, not
  // nested three levels deep inside PlanGraph's own DOM. `onClose` below
  // IS PlanGraph's own internal `closePanel` — focus-restoration to the
  // triggering card still works correctly even though the panel now
  // mounts elsewhere in the tree.
  const [detailPanel, setDetailPanel] = useState<{ node: PlanNode; context: PlanContext; onClose: () => void } | undefined>(undefined)

  // Design review (docs/12-ui-redesign-spec.md §2's metrics strip:
  // "total, node count, collapsed count, colour legend...") — collapsed
  // count for display only, reported outward by PlanGraph itself; see
  // that prop's own doc comment for why this isn't a second copy of the
  // real collapse state.
  const [collapsedCount, setCollapsedCount] = useState(0)

  // Episode 18, Story 18.3 — Beginner/Expert lifted to page state (the
  // app-bar segmented control), replacing DetailPanel.tsx's own former
  // local useState — that file's doc comment had flagged this as a future
  // step since Story 6.2 shipped it. Page-scoped, not reset by anything
  // that resets PlanGraph's own internal state (a different node, a fresh
  // plan) — that's the entire point of lifting it: picking Expert once and
  // having it stay Expert while browsing. Shared with Story 18.9's
  // walkthrough once that exists, per spec §2.
  const [expertMode, setExpertMode] = useState(false)

  // Episode 18, Story 18.2 — spec §2's breakpoint table: below 860px of
  // the SHELL's own width (not the viewport — this is exactly why
  // `.plan-shell` is a `container-type: inline-size` context), Findings
  // and the graph become tabs instead of a side-by-side rail+canvas.
  // jsdom's ResizeObserver is a no-op stub (src/__tests__/setup.ts) — this
  // only ever fires in a real browser, so component tests exercise the
  // "wide" branch and e2e tests exercise the narrow one, matching this
  // story's own testing approach.
  const NARROW_SHELL_BREAKPOINT_PX = 860
  // Episode 18, Story 18.12 — spec §2b's breakpoint table names 620px as
  // the "mobile layout" step ("Detail becomes a bottom sheet"). Note this
  // conflicts with §5 `1k`'s own prose ("Below 900px..."/"below 480px
  // specifically") — a genuine spec-internal inconsistency, not resolved
  // by picking whichever number sounded closest. Resolved in favor of the
  // structured §2b table: it's the single source of truth for every OTHER
  // structural breakpoint (1180, 860) this app already implements against,
  // including this exact `isNarrowShell` state one breakpoint up, and this
  // file's own Story 18.2 comment already reserved "the true-mobile
  // (620px, Story 18.12) rule" — i.e. this was already the intended target
  // before this story even started. See BACKLOG-STATUS.md's Story 18.12
  // row for the full account.
  const MOBILE_SHELL_BREAKPOINT_PX = 620
  const shellRef = useRef<HTMLElement>(null)
  const [isNarrowShell, setIsNarrowShell] = useState(false)
  const [isMobileShell, setIsMobileShell] = useState(false)
  // Which tab shows at narrow widths. Defaults to "graph" at the 860px
  // (tablet) breakpoint, which can still usefully show a graph — "Findings
  // lead, not the graph" (spec §5 `1k`) is specifically the true-mobile
  // rule, applied by the dedicated layout effect below (keyed on `analyzed`
  // itself, not a resize) every time a genuinely NEW plan is analyzed —
  // see that effect's own comment for why a resize-driven approach doesn't
  // work here (a same-size re-analysis fires no new ResizeObserver
  // callback at all) and why re-deriving it only on a fresh `analyzed`
  // (not on every statement-tab switch, or on window resize/rotation)
  // still respects a user's own manual tab choice in both of those cases.
  const [activeShellTab, setActiveShellTab] = useState<"findings" | "graph">("graph")

  // Episode 14, Story 14.2 — comparison view. Deliberately independent of
  // every persistence/share-link concern above: the comparison plan is
  // never saved, restored, or shareable-linked — only the primary plan is
  // (see ComparePasteBox's own comment for why).
  const [compareMode, setCompareMode] = useState(false)
  const [comparePlan, setComparePlan] = useState<AnalyzedPlan | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)

  // Episode 17 — local persistence state.
  const [restoreCandidate, setRestoreCandidate] = useState<{ text: string; savedAt: number } | null>(null)
  const [recentPlans, setRecentPlans] = useState<RecentPlanEntry[]>([])
  const [dontSave, setDontSave] = useState(false)
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null)

  const refreshRecentPlans = useCallback(() => {
    listRecentPlans().then(setRecentPlans)
  }, [])

  // Only offer a restore when no share-link already took priority on this
  // load (loadFromLocationHash, above) — a returning visitor who clicked a
  // link they were sent shouldn't ALSO be asked about an unrelated earlier
  // session in the same breath.
  useEffect(() => {
    if (initial) return
    loadSession().then((result) => {
      if (result.ok) setRestoreCandidate({ text: result.text, savedAt: result.savedAt })
    })
  }, [initial])

  useEffect(() => {
    refreshRecentPlans()
  }, [refreshRecentPlans])

  // Episode 18, Story 18.8 — global keyboard shortcuts to open the search
  // palette, reachable from anywhere on the page (not just when the graph
  // itself has focus). `⌘K`/`Ctrl+K` needs no guard — no ordinary text
  // input treats that combination as its own input. `/` is a printable
  // character, though, so it's guarded against hijacking a focused text
  // input/textarea (typing "/" into the paste box or a search box
  // shouldn't pop the palette open underneath the user's cursor) — the
  // story's own explicit edge case.
  useEffect(() => {
    if (!analyzed) return // nothing to search until a plan is actually loaded
    const handleKeyDown = (event: KeyboardEvent) => {
      const isTypingTarget =
        event.target instanceof HTMLElement &&
        (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable)
      const isOpenShortcut = (event.key === "/" && !isTypingTarget) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      if (!isOpenShortcut) return
      event.preventDefault()
      setIsSearchPaletteOpen(true)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [analyzed])

  const debouncedSaveSession = useMemo(
    () =>
      debounce((text: string) => {
        saveSession(text).then((result) => {
          if (!result.ok && result.reason === "quota_exceeded") {
            setPersistenceNotice(
              "Couldn't save your session locally — your browser's storage is full, so this won't be restored after a refresh.",
            )
          }
        })
      }, SESSION_SAVE_DEBOUNCE_MS),
    [],
  )

  const handleAnalyze = useCallback(
    (text: string) => {
      setRawText(text)
      try {
        const result = analyzePlanText(text)
        setAnalyzed(result)
        setActiveStatementIndex(0)
        setError(null)
        setRestoreCandidate(null) // a fresh analyze supersedes any pending restore offer
        setMatchedNodeIds(undefined) // a stale search over the previous plan's tree, see the statement-tab click handler's comment
        setIsWalkthroughOpen(false) // same reasoning — a walkthrough's step list is built from a specific tree too
        // Story 18.12: the mobile-default-tab layout effect below (keyed
        // on `analyzed`) re-derives `activeShellTab` for THIS fresh
        // "result screen" — nothing to do here directly; see that effect.

        if (!dontSave) {
          debouncedSaveSession(text)
          const primaryRoot = result.statements[0].root
          const nodeCount = result.statements.reduce((sum, stmt) => sum + collectNodes(stmt.root).length, 0)
          addRecentPlan(text, { rootOperatorLabel: primaryRoot.rawOperatorLabel, nodeCount }).then(refreshRecentPlans)
        }
      } catch (err) {
        setAnalyzed(null)
        // PlanParseError messages are already structural-only (never echo raw
        // pasted content) — see the privacy-architecture skill — so it's safe
        // to show err.message directly.
        setError(err instanceof PlanParseError ? err.message : "Something went wrong reading this plan.")
      }
    },
    [dontSave, debouncedSaveSession, refreshRecentPlans],
  )

  const handleCompareAnalyze = useCallback((text: string) => {
    try {
      setComparePlan(analyzePlanText(text))
      setCompareError(null)
    } catch (err) {
      setComparePlan(null)
      // Same rule as handleAnalyze above: PlanParseError messages never
      // echo raw pasted content, so showing err.message directly is safe.
      setCompareError(err instanceof PlanParseError ? err.message : "Something went wrong reading this plan.")
    }
  }, [])

  const handleStopComparing = useCallback(() => {
    setCompareMode(false)
    setComparePlan(null)
    setCompareError(null)
    setDetailPanel(undefined) // stale reference into a PlanGraph instance that's about to unmount
  }, [])

  const handleEnterCompareMode = useCallback(() => {
    setCompareMode(true)
    setDetailPanel(undefined)
  }, [])

  const handleDismissRestore = useCallback(() => setRestoreCandidate(null), [])

  const handleClearSavedData = useCallback(() => {
    clearSession()
    clearAllRecentPlans().then(refreshRecentPlans)
    setRestoreCandidate(null)
  }, [refreshRecentPlans])

  const handleDeleteRecentPlan = useCallback(
    (id: string) => {
      deleteRecentPlan(id).then(refreshRecentPlans)
    },
    [refreshRecentPlans],
  )

  // Scoped to the recent-plans list only — distinct from
  // handleClearSavedData (PasteBox's control), which wipes both the
  // current-session restore candidate AND this list. A "Clear all" button
  // inside the recent-plans section shouldn't also silently discard an
  // unrelated pending restore offer the user hasn't even seen yet.
  const handleClearAllRecentPlans = useCallback(() => {
    clearAllRecentPlans().then(refreshRecentPlans)
  }, [refreshRecentPlans])

  const activeStatement = analyzed?.statements[activeStatementIndex]

  // Design review — the metrics strip's colour/width legend needs to name
  // whatever `buildGraphElements.ts`'s `pickMetricValue` actually fell
  // back to for THIS plan (its own priority order:
  // actualTimeMs ?? estimatedCost ?? actualRows ?? estimatedRows) — see
  // that JSX's own comment for why a hardcoded "actual time" was wrong for
  // every Snowflake plan (no actual-time or cost concept at all) and any
  // estimate-only Postgres/SQL Server plan.
  //
  // Checked across EVERY node, not just the root: SQL Server's outermost
  // RelOp commonly carries no `RunTimeInformation` of its own even when
  // every node under it does (a join/aggregate summary op with no
  // separate profiling block of its own is a normal, common shape, not
  // an edge case — confirmed against this project's own `hash-join.xml`
  // fixture) — checking only `root.actualTimeMs` said "estimated cost"
  // for a plan whose child nodes were plainly showing real millisecond
  // timings on screen. Postgres's own cumulative-from-root convention
  // means its root always carries the figure when any node has one, so
  // this is strictly more correct there too, never less.
  const activeStatementNodes = activeStatement ? collectNodes(activeStatement.root) : []
  const metricLabel = activeStatementNodes.some((n) => n.actualTimeMs !== undefined)
    ? "actual time"
    : activeStatementNodes.some((n) => n.estimatedCost !== undefined)
      ? "estimated cost"
      : "rows"

  // Episode 19: `.plan-shell` now mounts unconditionally on first paint
  // (it's the app's only page), so this observes once and never needs to
  // re-attach — unlike before Episode 19, when the section itself only
  // existed once a plan was analyzed.
  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const width = entry.contentRect.width
      setIsNarrowShell(width < NARROW_SHELL_BREAKPOINT_PX)
      setIsMobileShell(width < MOBILE_SHELL_BREAKPOINT_PX)
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Episode 18, Story 18.12 — the mobile default-tab rule, deliberately
  // NOT folded into the ResizeObserver effect above: ResizeObserver only
  // calls back when the observed box's size actually CHANGES, so
  // re-analyzing a different plan at the SAME container width (the most
  // common case — the browser window didn't move) would never re-fire it,
  // silently keeping whatever tab was active from the PREVIOUS plan. A
  // fresh `analyzed` is a fresh "result screen" (spec §5 `1k`'s own
  // "input screen -> result screen" framing) and re-derives the default
  // every time — but ONLY then, not on every statement-tab switch (a
  // different `analyzed.statements[i]`, same `analyzed` object) and not on
  // a later resize/rotation, both of which must leave a user's own manual
  // tab choice alone (this story's own edge cases). `useLayoutEffect`
  // (not `useEffect`) so the real `getBoundingClientRect` measurement
  // happens synchronously right after the shell's first mount for THIS
  // plan, before paint — no flash of the wrong default tab.
  useLayoutEffect(() => {
    if (!analyzed) return
    const el = shellRef.current
    if (!el) return
    const width = el.getBoundingClientRect().width
    setActiveShellTab(width < MOBILE_SHELL_BREAKPOINT_PX ? "findings" : "graph")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzed])

  const handleDetailPanelChange = useCallback(
    (panel: { node: PlanNode; context: PlanContext; onClose: () => void } | undefined) => setDetailPanel(panel),
    [],
  )

  // Episode 18, Story 18.11 — entirely client-side: the Blob and the
  // download link it becomes never touch the network, so this needs no
  // privacy-architecture review the way a real upload/export-to-server
  // action would.
  const handleExportPng = useCallback(async () => {
    setExportError(null)
    const blob = await planGraphRef.current?.exportPng()
    if (!blob) {
      setExportError("Couldn't export this plan as an image — try a different browser.")
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `planreader-${analyzed?.engine ?? "plan"}.png`
    link.click()
    URL.revokeObjectURL(url)
  }, [analyzed?.engine])

  // Episode 19 — the left rail's "New plan" action: returns to the empty
  // first-load state without touching anything saved locally (that's the
  // separate "Clear saved data" control's job, unchanged by this).
  const handleNewPlan = useCallback(() => {
    setAnalyzed(null)
    setRawText("")
    setError(null)
    setActiveStatementIndex(0)
    setDetailPanel(undefined)
    setFocusNodeId(undefined)
    setMatchedNodeIds(undefined)
    setIsWalkthroughOpen(false)
    setIsSearchPaletteOpen(false)
    setCompareMode(false)
    setComparePlan(null)
    setCompareError(null)
    setExportError(null)
  }, [])

  return (
    <main className="plan-reader-page">
      {/* Episode 19: `.plan-shell` is now the app's only page — it renders
          unconditionally from first paint, not gated behind `analyzed` the
          way it was through Episode 18. Story 8.1's hero (headline/
          subheadline/engine badges, always above the fold) is retired by
          this same change — a deliberate, user-directed supersession of
          that AC and of spec §7's matching hero constraint, not a silent
          regression. See docs/08-episodes-and-stories.md's Episode 19
          header and BACKLOG-STATUS.md's matching row for the full account.

          `container-type: inline-size` (Story 18.2) still drives every
          breakpoint below (app-bar gaps, the 1180px detail-panel switch,
          the 860px findings/graph tab switch) against THIS element's own
          width, not the viewport. `ref`/`data-testid="plan-result"` kept on
          the same element every pre-existing test already targets. */}
      <section
        ref={shellRef}
        className="plan-reader-page__result plan-shell"
        data-testid="plan-result"
        // Episode 18, Story 18.12 — a deterministic hook for tests (and
        // any future mobile-specific behavior) rather than every
        // consumer re-deriving "is this the true-mobile breakpoint" from
        // a raw pixel width of its own. The bottom-sheet/touch-target
        // CSS itself is still driven by the real `@container`/`@media`
        // breakpoints (unaffected by this attribute), not this flag.
        data-mobile-shell={isMobileShell || undefined}
      >
          <header className="plan-shell__app-bar">
            {/* Design-mockup review (post-Episode-18): spec §1's icon row
                — "Phosphor regular; fill weight only for the brand mark" —
                names a brand mark that was never actually built; the
                mockup renders it as a filled tree-structure glyph. */}
            <span className="plan-shell__brand">
              <TreeStructure className="plan-shell__brand-icon" weight="fill" aria-hidden="true" />
              PlanReader
            </span>
            {/* Episode 19: every control below only means something once a
                plan is loaded (an engine to badge, a query to walk through,
                a link/image to share/export) — absent, not disabled, until
                then, so the empty first-load app bar shows just the brand. */}
            {analyzed && (
              <>
                {/* spec §2's app-bar order has a "filename" slot here (a
                    dropped/picked file's name, truncating). There's no real
                    filename yet — plans only arrive via paste until Story
                    18.5's file input lands — so this is intentionally omitted
                    rather than showing an empty or fabricated placeholder. */}
                <span className="plan-shell__engine-badge" data-testid="detected-engine-badge">
                  {ENGINE_LABEL[analyzed.engine]}
                </span>
                <span className="plan-shell__spacer" />
                {/* Story 18.3: page-level Beginner/Expert, replacing the
                    Story 18.2 placeholder — shared with the detail panel
                    (passed down below) and, per spec §2, with Story 18.9's
                    walkthrough below (same lifted state, not a third
                    toggle). */}
                <div className="plan-shell__mode-toggle" role="group" aria-label="Detail level">
                  <button
                    type="button"
                    className="plan-shell__mode-toggle-button"
                    aria-pressed={!expertMode}
                    data-testid="shell-mode-beginner"
                    onClick={() => setExpertMode(false)}
                  >
                    Beginner
                  </button>
                  <button
                    type="button"
                    className="plan-shell__mode-toggle-button"
                    aria-pressed={expertMode}
                    data-testid="shell-mode-expert"
                    onClick={() => setExpertMode(true)}
                  >
                    Expert
                  </button>
                </div>
                <button
                  type="button"
                  className="plan-shell__app-bar-button"
                  data-testid="walkthrough-open"
                  onClick={() => setIsWalkthroughOpen(true)}
                >
                  Walk me through it
                </button>
                {!compareMode && (
                  <button type="button" className="compare-toggle" data-testid="compare-toggle" onClick={handleEnterCompareMode}>
                    Compare with another plan
                  </button>
                )}
                <ShareLinkButton rawText={rawText} />
                {/* Spec §2: "Share and Export drop to icon-only before
                    wrapping." Was deferred pending real icon assets — Story
                    18.4's operator icon set (@phosphor-icons/react) shipped
                    since, so that blocker's gone; see planReaderPage.css's
                    own comment for the measured (not assumed) breakpoint. */}
                <button
                  type="button"
                  className="plan-shell__app-bar-button plan-shell__app-bar-button--icon-only"
                  data-testid="export-png-button"
                  onClick={handleExportPng}
                  aria-label="Export as PNG"
                >
                  <DownloadSimple className="plan-shell__app-bar-button-icon" weight="regular" aria-hidden="true" />
                  <span className="plan-shell__app-bar-button-label">Export</span>
                </button>
              </>
            )}
          </header>

          {exportError && <Notice severity="critical">{exportError}</Notice>}

          {analyzed && analyzed.queryTextRedacted && (
            // Warning tier (spec §5 `1e`: "amber = partial result
            // available") — the plan itself parsed and rendered fine, but
            // with a real caveat (no query text to correlate against).
            <Notice severity="warning">Query text redacted by account policy.</Notice>
          )}

          {/* Episode 18, Story 18.6's edge case: the parameter-sensitivity
              and estimate-only honesty notes (both root-level, info-
              severity Warnings from the rule engine) must be visible here
              directly — not only reachable by opening the root node's own
              detail panel, or by expanding the findings list, which is
              collapsed by default (Story 13.1). Informational tier (spec
              §5 `1e`: "blurple = informational") — nothing is wrong, this
              is a disclosure, not a problem. */}
          {activeStatement &&
            activeStatement.root.warnings
              .filter((w) => w.ruleId === "parameter-sensitivity-honesty-note" || w.ruleId === "estimate-only-plan")
              .map((w) => (
                <Notice key={w.ruleId} severity="info">
                  {w.shortText}
                </Notice>
              ))}

          {analyzed && analyzed.statements.length > 1 && (
            <div className="plan-reader-page__statement-tabs" role="tablist" aria-label="Statements in this batch">
              {analyzed.statements.map((stmt, index) => {
                const duration = formatStatementDuration(stmt.root)
                const severity = statementSeverity(stmt.root)
                return (
                  <button
                    key={stmt.label + index}
                    type="button"
                    role="tab"
                    aria-selected={index === activeStatementIndex}
                    className="plan-reader-page__statement-tab"
                    onClick={() => {
                      setActiveStatementIndex(index)
                      // Story 18.8: matched-id sets are keyed to a specific
                      // tree's node ids, which restart from "n0" per
                      // statement — carrying a stale set into a different
                      // statement's tree would dim/undim the wrong nodes.
                      setMatchedNodeIds(undefined)
                      setIsWalkthroughOpen(false)
                    }}
                  >
                    {/* Story 18.11 — additive to the existing tab label,
                        never replacing it: a duration figure (never
                        fabricated when neither actual time nor estimated
                        cost is available) and a severity dot. The dot is
                        never color alone — critical is a circle, warning a
                        diamond (a real shape difference, not just hue,
                        the same colorblind-safe reasoning the severity
                        ring elsewhere in this codebase already follows),
                        plus a screen-reader-only text label. */}
                    <span className="plan-reader-page__statement-tab-label">{stmt.label}</span>
                    {duration && (
                      <span className="plan-reader-page__statement-tab-duration" data-testid="statement-tab-duration">
                        {duration}
                      </span>
                    )}
                    {severity && (
                      <span
                        className={`plan-reader-page__statement-tab-severity plan-reader-page__statement-tab-severity--${severity}`}
                        data-testid="statement-tab-severity"
                        aria-hidden="true"
                      />
                    )}
                    {severity && <span className="plan-reader-page__sr-only">{SEVERITY_LABEL[severity]} severity</span>}
                  </button>
                )
              })}
            </div>
          )}

          {analyzed && activeStatement && compareMode ? (
            // Episode 14's comparison view is deliberately NOT part of the
            // shell grid below — Story 18.14 owns restyling it onto this
            // shell; spec §8 itself was written before Episode 14 shipped
            // this feature (see this episode's own goal note). Unchanged
            // from before this story.
            <div className="plan-reader-page__compare" data-testid="plan-reader-compare-section">
              {!comparePlan && <ComparePasteBox onAnalyze={handleCompareAnalyze} onCancel={handleStopComparing} />}

              {compareError && (
                <Notice severity="critical" data-testid="compare-parse-error">
                  {compareError}
                </Notice>
              )}

              {comparePlan && (
                <>
                  <button
                    type="button"
                    className="compare-toggle"
                    data-testid="stop-comparing"
                    onClick={handleStopComparing}
                  >
                    Stop comparing
                  </button>
                  {/* Story 14.2 scopes to one statement pair — the currently
                      active tab on the primary side, the first statement on
                      the comparison side. Comparing a specific pair from a
                      multi-statement batch on both sides is a real gap, not
                      silently papered over; documented here rather than
                      guessing which of N×M pairings the user meant. */}
                  <PlanComparisonView
                    planA={activeStatement.root}
                    planB={comparePlan.statements[0].root}
                    contextA={activeStatement.context}
                    contextB={comparePlan.statements[0].context}
                    labelA="Current plan"
                    labelB="Comparison plan"
                  />
                </>
              )}
            </div>
          ) : (
            <div className="plan-shell__body" data-testid="plan-shell-body">
              {/* Left rail (spec §2): "Plan input ... over Findings." Episode
                  19: Plan Input now lives here permanently, above Findings,
                  from the very first load — not in its old pre-shell
                  position, and never hidden by the narrow-shell tab switch
                  below (a plan must be reachable at every breakpoint, per
                  the user's own explicit edge case for this change).
                  Findings itself still respects that tab switch below
                  860px — it's what actually competes with the graph for
                  space, not Plan Input. */}
              <aside className="plan-shell__rail plan-shell__rail--left" data-testid="plan-shell-left-rail">
                <div className="plan-shell__input-section" data-testid="plan-shell-input-section">
                  <div className="plan-shell__input-section-header">
                    <h2 className="plan-shell__input-section-title">Plan input</h2>
                    {analyzed && (
                      <button
                        type="button"
                        className="plan-shell__new-plan-button"
                        data-testid="new-plan-button"
                        onClick={handleNewPlan}
                      >
                        New plan
                      </button>
                    )}
                  </div>

                  {restoreCandidate && (
                    <RestoreSessionBanner
                      savedAt={restoreCandidate.savedAt}
                      onRestore={() => handleAnalyze(restoreCandidate.text)}
                      onDismiss={handleDismissRestore}
                    />
                  )}

                  <PasteBox
                    onAnalyze={handleAnalyze}
                    initialText={initial?.rawText}
                    dontSave={dontSave}
                    onDontSaveChange={setDontSave}
                    hasSavedData={restoreCandidate !== null || recentPlans.length > 0}
                    onClearSavedData={handleClearSavedData}
                  />

                  {persistenceNotice && (
                    <p className="plan-reader-page__note" data-testid="persistence-notice">
                      {persistenceNotice}
                    </p>
                  )}

                  <RecentPlansList
                    plans={recentPlans}
                    onSelect={handleAnalyze}
                    onDelete={handleDeleteRecentPlan}
                    onClearAll={handleClearAllRecentPlans}
                  />

                  {error && (
                    <Notice severity="critical" data-testid="parse-error">
                      {error}
                    </Notice>
                  )}
                </div>

                {analyzed && activeStatement && (!isNarrowShell || activeShellTab === "findings") && (
                  <FindingsList root={activeStatement.root} onSelectNode={setFocusNodeId} />
                )}
              </aside>

              {analyzed && isNarrowShell && (
                <div className="plan-shell__tabs" role="tablist" aria-label="Findings and graph">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeShellTab === "findings"}
                    className="plan-shell__tab"
                    data-testid="shell-tab-findings"
                    onClick={() => setActiveShellTab("findings")}
                  >
                    Findings
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeShellTab === "graph"}
                    className="plan-shell__tab"
                    data-testid="shell-tab-graph"
                    onClick={() => setActiveShellTab("graph")}
                  >
                    Graph
                  </button>
                </div>
              )}

              {!analyzed && (
                // Episode 19's chosen empty state (confirmed with the user):
                // a plain, honest placeholder — not the retired marketing
                // hero, not a fabricated preview of the graph.
                <main className="plan-shell__canvas plan-shell__canvas--empty" data-testid="plan-shell-canvas">
                  <p className="plan-shell__empty-placeholder" data-testid="plan-shell-empty-placeholder">
                    Paste a plan on the left to see it visualized here.
                  </p>
                </main>
              )}

              {analyzed && activeStatement && (!isNarrowShell || activeShellTab === "graph") && (
                <main className="plan-shell__canvas" data-testid="plan-shell-canvas">
                  {/* Design review — the lead-in clause up to the colon
                      (`OPENERS[severity]`, summarize.ts) gets a severity
                      color (bold red for critical, matching the reference
                      mock); the rest of the sentence stays the normal
                      muted body color. `summary.text` itself is untouched
                      — this only affects how it's split for styling. */}
                  <p className="plan-shell__summary" data-testid="plan-summary">
                    {activeStatement.summary.severity !== "none" ? (
                      <>
                        <span
                          className={`plan-shell__summary-opener plan-shell__summary-opener--${activeStatement.summary.severity}`}
                        >
                          {OPENERS[activeStatement.summary.severity]}
                        </span>
                        {activeStatement.summary.text.slice(OPENERS[activeStatement.summary.severity].length)}
                      </>
                    ) : (
                      activeStatement.summary.text
                    )}
                  </p>

                  {/* Design review — completes spec §2's metrics strip:
                      "total, node count, collapsed count, colour legend,
                      Width = rows · Arrows = execution order". Node count
                      and the plain-language caption already shipped with
                      the shell itself; total time, collapsed count, and
                      the colour legend were deferred to Story 18.4's node-
                      encoding work (a legend is meaningless without the
                      encoding it explains) — that work (buildMetricScale's
                      colorFor/sizeFor, wired into buildGraphElements.ts)
                      shipped, but this strip was never circled back to.
                      `collapsedCount` is reported outward by PlanGraph
                      itself (see its own `onCollapsedCountChange` prop's
                      doc comment) — this component never touches collapse
                      state directly. */}
                  {/* Design review — `metricLabel` names whatever
                      `buildGraphElements.ts`'s `pickMetricValue` actually
                      fell back to for THIS plan (it drives both node
                      colour and width together — one metric, two
                      encodings, never two different ones despite the
                      separate-sounding legend text): "actual time" when
                      ANALYZE/runtime stats are present, else "estimated
                      cost" (an estimate-only Postgres/SQL Server plan),
                      else plain "rows" — Snowflake's own honest floor,
                      since it exposes neither actual time nor an abstract
                      cost unit at all (buildStatRows.ts's own `rowsCost`
                      comment). A hardcoded "actual time" here previously
                      named a metric that's literally always undefined for
                      every Snowflake plan — the size/colour encoding was
                      quietly running on rows the whole time with a label
                      claiming otherwise. */}
                  <div className="plan-shell__metrics-strip" data-testid="plan-shell-metrics">
                    {activeStatement.root.actualTimeMs !== undefined && (
                      <span>Total {formatNumber(Math.round(activeStatement.root.actualTimeMs))} ms</span>
                    )}
                    <span>{activeStatementNodes.length.toLocaleString("en-US")} nodes</span>
                    {collapsedCount > 0 && <span>{collapsedCount} collapsed</span>}
                    <span className="plan-shell__colour-legend">
                      Colour
                      <span className="plan-shell__colour-legend-swatch" aria-hidden="true" />
                      {metricLabel}
                    </span>
                    <span>Width = {metricLabel} · Arrows = execution order</span>
                  </div>

                  <div className="plan-shell__graph">
                    {/* Design review (reference mock) — a persistent, always-
                        visible entry point into the search palette (the
                        modal itself, and its `/`/⌘K shortcuts, are
                        unchanged — Story 18.8's own tests still cover
                        those); this is just a second, discoverable way to
                        open the same thing for anyone who'd never guess a
                        keyboard shortcut exists. */}
                    <button
                      type="button"
                      className="plan-shell__search-trigger"
                      data-testid="graph-search-trigger"
                      onClick={() => setIsSearchPaletteOpen(true)}
                    >
                      <MagnifyingGlass aria-hidden="true" />
                      <span>Find operator, table, or index…</span>
                      <kbd>/</kbd>
                    </button>
                    <PlanGraph
                      ref={planGraphRef}
                      root={activeStatement.root}
                      context={activeStatement.context}
                      focusNodeId={focusNodeId}
                      onFocusHandled={() => setFocusNodeId(undefined)}
                      externalDetailPanel
                      onDetailPanelChange={handleDetailPanelChange}
                      matchedNodeIds={matchedNodeIds}
                      onCollapsedCountChange={setCollapsedCount}
                    />
                  </div>
                </main>
              )}

              {/* Right rail: a true grid track above 1180px of the shell's
                  own width, an overlay-with-scrim below it — the
                  `detail-panel--in-shell` variant and this scrim compose to
                  do that; see detailPanel.css and planReaderPage.css. Always
                  mounted now (Episode 19) — empty until a node is opened,
                  same as before. */}
              <aside className="plan-shell__rail plan-shell__rail--right" data-testid="plan-shell-right-rail">
                {detailPanel && (
                  <DetailPanel
                    node={detailPanel.node}
                    context={detailPanel.context}
                    onClose={detailPanel.onClose}
                    variant="shell"
                    expertMode={expertMode}
                    onExpertModeChange={setExpertMode}
                  />
                )}
              </aside>
              {detailPanel && (
                <div className="plan-shell__detail-scrim" data-testid="plan-shell-detail-scrim" onClick={detailPanel.onClose} />
              )}
            </div>
          )}
        </section>

      {/* Episode 18, Story 18.8 — a global overlay, deliberately rendered
          outside .plan-shell so its `position: fixed` scrim can never be
          clipped/repositioned by a transformed ancestor (the same
          `position: fixed` escaping concern detailPanel.css's own module
          comment documents). Only reachable once a plan is actually
          loaded — `activeStatement` is what it searches. */}
      {isSearchPaletteOpen && activeStatement && (
        <SearchPalette
          root={activeStatement.root}
          onSelectNode={setFocusNodeId}
          onClose={() => setIsSearchPaletteOpen(false)}
          onMatchedIdsChange={setMatchedNodeIds}
        />
      )}

      {/* Episode 18, Story 18.9 — full-screen, sits above the shell
          (including an already-open detail panel) so the graph reads as
          dimmed-but-visible behind it, per spec §5 `1g`. */}
      {isWalkthroughOpen && activeStatement && (
        <WalkthroughOverlay
          root={activeStatement.root}
          context={activeStatement.context}
          expertMode={expertMode}
          onExpertModeChange={setExpertMode}
          onExit={(lastViewedNodeId) => {
            setIsWalkthroughOpen(false)
            setFocusNodeId(lastViewedNodeId)
          }}
        />
      )}

      {/* Brief's on-page checklist: connect the tool to Kiran's existing
          execution-plan content for credibility with a first-time,
          skeptical visitor. No hyperlink here — there's no real URL for the
          video series/blog post in this project's docs yet (a known,
          tracked gap; see Episode 12's content-linking story), and a
          fabricated link would be worse than none. */}
      <footer className="plan-reader-page__footer">
        <p>Built by Kiran, creator of the @scalingbackend execution-plan video series and blog post.</p>
      </footer>
    </main>
  )
}
