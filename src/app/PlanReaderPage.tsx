import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowsLeftRight, Compass, DownloadSimple, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react"
import { PasteBox } from "./PasteBox"
import { Notice } from "./Notice"
import { ComparePasteBox } from "./ComparePasteBox"
import { ShareLinkButton } from "./ShareLinkButton"
import { RestoreSessionBanner } from "./RestoreSessionBanner"
import { RecentPlansList } from "./RecentPlansList"
import { IconRail, type IconRailPanel } from "./IconRail"
import { analyzePlanText, type AnalyzedPlan } from "./analyzePlan"
import { formatStatementDuration, statementSeverity, buildStatementTabRows, findDefaultStatementIndex } from "./statementTabSummary"
import { decodeShareLink } from "./shareLink"
// Episode 19: the hero landing page this copy served is retired — the
// three-column shell is now the app's only page, from first load, per the
// user-supplied mockup screenshot. positioningCopy.ts's exports stay in
// place (Story 8.1's brief-matching requirement is still true of the
// source file itself) for a future first-time-visitor-credibility pass to
// start from, just unused here today. See docs/08-episodes-and-stories.md's
// Episode 19 header for the full account of what this supersedes.
import {
  PlanGraph,
  FindingsList,
  FindingsDrawer,
  PlanComparisonView,
  DetailPanel,
  SearchPalette,
  WalkthroughOverlay,
  SEVERITY_LABEL,
  QueryHealthCard,
  type PlanGraphHandle,
} from "../graph"
import { PlanParseError, collectNodes, type PlanNode } from "../parsers/normalize"
import type { PlanContext } from "../rules/types"
import { formatNumber } from "../rules/format"
import { OPENERS } from "../rules/summarize"
import { collectFindingsAcrossStatements } from "../rules/findings"
import { computeQueryHealth } from "../rules/queryHealth"
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
  // Story 20.1: defaults to the first NON-TRIVIAL statement (a real query,
  // or one with a finding) rather than always 0 — a large stored-procedure
  // plan's own statement 0 is frequently a trivial `DECLARE`, and landing
  // there by sheer accident of ordering is exactly the "buried under
  // control-flow noise" problem this story fixes. Applies to a share-link-
  // recovered plan on first paint too (`initial?.analyzed`), not just a
  // fresh paste — see `handleAnalyze` below for the other case.
  const [activeStatementIndex, setActiveStatementIndex] = useState(() =>
    initial?.analyzed ? findDefaultStatementIndex(initial.analyzed.statements.map((s) => s.root)) : 0,
  )
  // Story 20.1: which trivial-statement runs (keyed by the run's start
  // index) the user has manually expanded in the statement tab strip —
  // local UI state, reset whenever a genuinely new plan is analyzed, same
  // as `activeStatementIndex` right above.
  const [expandedStatementGroups, setExpandedStatementGroups] = useState<Set<number>>(new Set())
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

  // Episode 22, Story 22.1 — maximize the graph pane to fill the whole
  // browser viewport (a `position: fixed; inset: 0` CSS overlay, matching
  // WalkthroughOverlay's own established pattern — NOT the browser's real
  // Fullscreen API, see the episode's own feasibility note). Deliberately
  // NOT reset by `switchToStatement` — switching statements while
  // maximized re-renders the same maximized graph pane with a different
  // tree, it never exits maximized mode (this story's own edge case).
  // Reset on a genuinely new plan (`handleAnalyze`/`handleNewPlan`, same as
  // `isWalkthroughOpen` above), since a fresh "result screen" shouldn't
  // silently inherit the previous plan's maximized chrome.
  const [isMaximized, setIsMaximized] = useState(false)
  // Confirmed with the user: Findings stays reachable while maximized —
  // since the left rail itself is visually covered by the maximized
  // overlay (same reasoning as Beginner/Expert and Walk-me-through below),
  // this drives a small drawer rendered INSIDE the maximized pane instead,
  // reusing the exact same `<FindingsList>` component/props the left rail
  // already uses — not a second content surface.
  const [isMaximizedFindingsOpen, setIsMaximizedFindingsOpen] = useState(false)

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

  // Story 6.3 — the detail panel is an overlay by default (never a
  // reflow — see DetailPanel's own `variant="overlay"`, already the
  // always-fixed behavior every OTHER caller in this app already uses);
  // pinning switches this SAME right-rail instance to `variant="shell"`,
  // restoring the pre-existing grid-track-above-1180px behavior for as
  // long as it's on. Session-only state, not persisted across reloads —
  // a deliberate, disclosed scope limit, the same shape `dontSave` above
  // already has.
  const [isDetailPinned, setIsDetailPinned] = useState(false)

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
  // Episode 26, Story 26.4 — the status bar's own branding-chip disclosure
  // (the old page footer's attribution sentence, relocated on-demand).
  // Local UI state, not persisted or reset on a fresh analyze — there's no
  // per-plan meaning to "was this open," unlike e.g. `activeStatementIndex`.
  const [isAboutOpen, setIsAboutOpen] = useState(false)

  // Episode 18, Story 18.12 — spec §2b's breakpoint table names 620px as
  // the "mobile layout" step ("Detail becomes a bottom sheet"). Note this
  // conflicts with §5 `1k`'s own prose ("Below 900px..."/"below 480px
  // specifically") — a genuine spec-internal inconsistency, not resolved
  // by picking whichever number sounded closest. Resolved in favor of the
  // structured §2b table: it's the single source of truth for every OTHER
  // structural breakpoint (1180, 860 — now retired, see below) this app
  // already implements against. See BACKLOG-STATUS.md's Story 18.12 row
  // for the full account.
  const MOBILE_SHELL_BREAKPOINT_PX = 620
  const shellRef = useRef<HTMLElement>(null)
  const [isMobileShell, setIsMobileShell] = useState(false)

  // Story 6.3 — RETIRES the Story 18.2/18.12 "Findings and the graph
  // become tabs below 860px" mechanism (`isNarrowShell`/`activeShellTab`,
  // both removed). Its entire premise was Findings and the graph
  // competing for the SAME side-by-side space as two full-height rail/
  // canvas regions — once Findings moves into a bottom drawer INSIDE the
  // canvas pane (see the icon rail / FindingsDrawer below), the two tabs
  // would show near-identical content (both include the graph; only the
  // drawer's own open/closed state would differ), which stopped being a
  // meaningful choice. The underlying INTENT the tabs served on true
  // mobile — spec §5 `1k`'s "Findings leads, not the graph" — is
  // preserved through the SAME layout-effect mechanism below, just
  // driving the findings drawer's default open state instead of which
  // tab is active.
  // Starts open when a plan arrives pre-loaded on first paint (a restored
  // share link, Story 11.2) — that feature's whole point is showing the
  // recovered text immediately, without an extra click to reveal it;
  // otherwise closed, the ordinary "fresh visit, then paste" case.
  const [activeRailPanel, setActiveRailPanel] = useState<IconRailPanel>(initial?.analyzed ? "new-plan" : null)
  const [isFindingsDrawerOpen, setIsFindingsDrawerOpen] = useState(false)

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

  // Episode 22, Story 22.1 — Escape restores from maximized mode. A
  // document-level listener (matching DetailPanel.tsx's own Escape-to-close
  // — see that file), not an element-scoped one on the maximized container
  // itself: `.plan-shell__graph--maximized`'s content includes a plain
  // `<button>` toolbar with no natural single "dialog" element to attach a
  // scoped handler to the way WalkthroughOverlay/SearchPalette do.
  // Explicit, tested stacking order (this story's own AC) for the SAME
  // keydown event potentially reaching more than one document-level
  // listener at once:
  //   - WalkthroughOverlay/SearchPalette open on top "win" outright — they
  //     mount outside this element's own subtree with their own element-
  //     scoped Escape handlers that never call stopPropagation, so this
  //     document listener still fires unless explicitly guarded here.
  //   - An open detail panel (rendered INSIDE the maximized pane by this
  //     story, reusing DetailPanel's own document-level Escape-to-close)
  //     closes FIRST — innermost-modal-first, standard nested-dialog
  //     convention — a second Escape then restores from maximize.
  useEffect(() => {
    if (!isMaximized) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (isWalkthroughOpen || isSearchPaletteOpen || detailPanel) return
      setIsMaximized(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isMaximized, isWalkthroughOpen, isSearchPaletteOpen, detailPanel])

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
        setActiveStatementIndex(findDefaultStatementIndex(result.statements.map((s) => s.root)))
        setExpandedStatementGroups(new Set())
        setError(null)
        setRestoreCandidate(null) // a fresh analyze supersedes any pending restore offer
        setMatchedNodeIds(undefined) // a stale search over the previous plan's tree, see the statement-tab click handler's comment
        setIsWalkthroughOpen(false) // same reasoning — a walkthrough's step list is built from a specific tree too
        setIsMaximized(false) // Story 22.1 — a fresh "result screen" starts un-maximized, same reasoning as isWalkthroughOpen above
        setIsMaximizedFindingsOpen(false)
        // Story 6.3 — the New Plan icon-rail panel auto-collapses right
        // after a successful analyze (the story's own explicit AC): the
        // raw pasted text isn't needed once results are showing, and
        // stays re-openable via the same icon to edit and re-analyze.
        setActiveRailPanel(null)
        // Story 18.12: the mobile-default-open layout effect below (keyed
        // on `analyzed`) re-derives `isFindingsDrawerOpen` for THIS fresh
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

  // Story 20.4 — the tab-click handler's own statement-switch logic,
  // extracted so the Findings panel's "jump to a finding on a different
  // statement" click goes through the exact same reset behavior (never a
  // second, independently-drifting copy of it). `buildStatementTabRows`
  // already guarantees a run containing this index renders expanded, so
  // no separate `expandedStatementGroups` update is needed here either.
  const switchToStatement = useCallback((index: number) => {
    setActiveStatementIndex(index)
    // Story 18.8: matched-id sets are keyed to a specific tree's node ids,
    // which restart from "n0" per statement — carrying a stale set into a
    // different statement's tree would dim/undim the wrong nodes.
    setMatchedNodeIds(undefined)
    setIsWalkthroughOpen(false)
  }, [])

  // Story 20.4 — every statement's root, for the Findings panel's
  // whole-batch view (not just `activeStatement`'s own tree).
  const findingsSources = useMemo(
    () => analyzed?.statements.map((stmt, i) => ({ statementIndex: i, statementLabel: stmt.label, root: stmt.root })) ?? [],
    [analyzed],
  )
  // Story 20.5 (found via manual testing on the same large batch): the two
  // header honesty notes (parameter-sensitivity, estimate-only) are
  // PLAN-WIDE facts — the rule engine attaches them to every statement's
  // own root, so switching between statements kept re-showing the exact
  // same two notes over and over, reading as the header "constantly
  // repopulating" on a large multi-statement batch. Both are genuinely
  // true for the whole batch or they aren't, so they're derived here from
  // ALL statements (same dedup `collectFindingsAcrossStatements` already
  // uses for the Findings panel — one definition, not two independently-
  // drifting ones) rather than re-filtered per `activeStatement` on every
  // click.
  const planWideNotices = useMemo(
    () =>
      collectFindingsAcrossStatements(findingsSources).filter(
        (f) => f.warning.ruleId === "parameter-sensitivity-honesty-note" || f.warning.ruleId === "estimate-only-plan",
      ),
    [findingsSources],
  )
  const handleSelectFinding = useCallback(
    (statementIndex: number, nodeId: string) => {
      if (statementIndex !== activeStatementIndex) switchToStatement(statementIndex)
      setFocusNodeId(nodeId)
    },
    [activeStatementIndex, switchToStatement],
  )

  // Episode 26, Story 26.2 — "opening the Issues panel explicitly closes
  // [the New Plan/Recent Plans] overlay first if open": the two would
  // otherwise occupy the same left column. Wraps every path that can OPEN
  // the findings drawer (the icon rail's own Findings button, and
  // FindingsDrawer's own internal summary-row toggle) — only closes
  // `activeRailPanel` on the OPEN transition, never on close, so collapsing
  // Findings doesn't fight a panel the user separately opened afterward.
  const handleFindingsOpenChange = useCallback((open: boolean) => {
    setIsFindingsDrawerOpen(open)
    if (open) setActiveRailPanel(null)
  }, [])

  // Story 6.3 — whole-batch severity counts, read TWICE from the same
  // underlying `collectFindingsAcrossStatements` computation: once here
  // (feeding both the icon rail's Findings badge and the drawer's
  // collapsed summary line) and once more inside `FindingsList` itself
  // (its own filtered/expanded rendering, `variant="compact"`). Calling
  // this pure, deterministic function twice over identical inputs is not
  // a "two sources of truth" risk — there's exactly one formula, computed
  // twice — and threading `allFindings` through as a prop would be a
  // bigger, riskier signature change touching every existing caller.
  const findingsSummary = useMemo(() => {
    const all = collectFindingsAcrossStatements(findingsSources)
    const critical = all.filter((f) => f.warning.severity === "critical").length
    const warning = all.filter((f) => f.warning.severity === "warning").length
    const info = all.filter((f) => f.warning.severity === "info").length
    const worstSeverity = critical > 0 ? "critical" : warning > 0 ? "warning" : info > 0 ? "info" : undefined
    return { total: all.length, critical, warning, info, worstSeverity } as const
  }, [findingsSources])

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

  // Episode 23, Story 23.1/23.3 — recomputed on every `activeStatement`
  // change (a fresh call keyed by object identity via useMemo, not cached
  // across statements) — the exact per-statement scoping mistake Story
  // 20.5 found and fixed for the header notices, applied here in the
  // opposite direction: this SHOULD change per statement, not persist.
  const queryHealth = useMemo(
    () => (activeStatement ? computeQueryHealth(activeStatement.root, activeStatement.context) : undefined),
    [activeStatement],
  )

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
      setIsMobileShell(entry.contentRect.width < MOBILE_SHELL_BREAKPOINT_PX)
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Story 6.3 — preserves spec §5 `1k`'s "Findings leads, not the graph"
  // intent on true mobile through the findings drawer's own default open
  // state, now that the retired tab mechanism no longer carries it (see
  // this file's own `activeRailPanel`/`isFindingsDrawerOpen` comment
  // above). Deliberately NOT folded into the ResizeObserver effect above,
  // for the exact same reason Story 18.12's own original version of this
  // effect wasn't: ResizeObserver only fires when the observed box's size
  // actually CHANGES, so re-analyzing a different plan at the SAME
  // container width (the common case) would never re-fire it, silently
  // keeping the PREVIOUS plan's drawer state. A fresh `analyzed` is a
  // fresh "result screen" and re-derives the default every time — but
  // ONLY then, not on every statement-tab switch or a later resize/
  // rotation, both of which must leave a user's own manual open/close
  // choice alone. `useLayoutEffect` (not `useEffect`) so the real
  // `getBoundingClientRect` measurement happens synchronously right after
  // the shell's first mount for THIS plan, before paint.
  useLayoutEffect(() => {
    if (!analyzed) return
    const el = shellRef.current
    if (!el) return
    const width = el.getBoundingClientRect().width
    setIsFindingsDrawerOpen(width < MOBILE_SHELL_BREAKPOINT_PX)
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
    setExpandedStatementGroups(new Set())
    setDetailPanel(undefined)
    setFocusNodeId(undefined)
    setMatchedNodeIds(undefined)
    setIsWalkthroughOpen(false)
    setIsSearchPaletteOpen(false)
    setIsMaximized(false) // Story 22.1 — same reasoning as handleAnalyze above
    setIsMaximizedFindingsOpen(false)
    setCompareMode(false)
    setComparePlan(null)
    setCompareError(null)
    setExportError(null)
    // Story 6.3 — a genuinely fresh empty state: `analyzed` becoming null
    // already reverts the left side to the pre-analysis inline input
    // layout (the icon rail only applies once a plan exists), but these
    // two reset explicitly anyway so nothing stale carries over if the
    // user pastes and analyzes again without a full page reload.
    setActiveRailPanel(null)
    setIsFindingsDrawerOpen(false)
    setIsDetailPinned(false)
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
                {/* Story 6.3 — icon-only unconditionally now (not just
                    below a breakpoint), matching Export's own established
                    icon+visually-hidden-label+aria-label shape below. The
                    aria-label text is identical to the old visible text —
                    the accessible name is unchanged, only its visual
                    presentation is. */}
                <button
                  type="button"
                  className="plan-shell__app-bar-button"
                  data-testid="walkthrough-open"
                  onClick={() => setIsWalkthroughOpen(true)}
                  aria-label="Walk me through it"
                  title="Walk me through it"
                >
                  <Compass className="plan-shell__app-bar-button-icon" weight="regular" aria-hidden="true" />
                  <span className="plan-shell__app-bar-button-label">Walk me through it</span>
                </button>
                {!compareMode && (
                  <button
                    type="button"
                    className="plan-shell__app-bar-button"
                    data-testid="compare-toggle"
                    onClick={handleEnterCompareMode}
                    aria-label="Compare with another plan"
                    title="Compare with another plan"
                  >
                    <ArrowsLeftRight className="plan-shell__app-bar-button-icon" weight="regular" aria-hidden="true" />
                    <span className="plan-shell__app-bar-button-label">Compare with another plan</span>
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
                  title="Export as PNG"
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
              is a disclosure, not a problem.
              Story 20.5: sourced from `planWideNotices` (deduped across
              the WHOLE batch), not `activeStatement` — these are batch-
              wide facts, so they render identically regardless of which
              statement is active, never re-populating on every tab click. */}
          {planWideNotices.map((f) => (
            <Notice key={f.warning.ruleId} severity="info">
              {f.warning.shortText}
            </Notice>
          ))}

          {analyzed && analyzed.statements.length > 1 && (
            <div className="plan-reader-page__statement-tabs" role="tablist" aria-label="Statements in this batch">
              {buildStatementTabRows(
                analyzed.statements.map((stmt) => stmt.root),
                activeStatementIndex,
                expandedStatementGroups,
              ).map((row) => {
                if (row.kind === "group") {
                  // Story 20.3: the SAME row toggles both directions — an
                  // expanded run keeps this control (right before the tabs
                  // it revealed) instead of vanishing once clicked, which
                  // previously left no way back to collapsed.
                  return (
                    <button
                      key={`group-${row.start}`}
                      type="button"
                      className="plan-reader-page__statement-tab plan-reader-page__statement-tab--group"
                      data-testid="statement-tab-group"
                      aria-expanded={row.expanded}
                      onClick={() =>
                        setExpandedStatementGroups((prev) => {
                          const next = new Set(prev)
                          if (row.expanded) next.delete(row.start)
                          else next.add(row.start)
                          return next
                        })
                      }
                    >
                      {row.expanded
                        ? `Collapse ${row.length} control-flow statement${row.length === 1 ? "" : "s"}`
                        : `${row.length} control-flow statement${row.length === 1 ? "" : "s"} — expand`}
                    </button>
                  )
                }
                const index = row.index
                const stmt = analyzed.statements[index]
                const duration = formatStatementDuration(stmt.root)
                const severity = statementSeverity(stmt.root)
                return (
                  <button
                    key={stmt.label + index}
                    type="button"
                    role="tab"
                    aria-selected={index === activeStatementIndex}
                    className="plan-reader-page__statement-tab"
                    onClick={() => switchToStatement(index)}
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
            <div
              // Story 6.3 — `--icon-rail` narrows the left column once a
              // plan is analyzed (the icon rail replaces the wide
              // pre-analysis input rail); `--detail-pinned` restores the
              // 3rd (right) grid track only while the detail panel is
              // pinned open — see planReaderPage.css's matching rules.
              // Un-pinned by default drops that track entirely: the
              // overlay panel is `position: fixed` and exerts no
              // influence on it either way.
              className={`plan-shell__body${analyzed ? " plan-shell__body--icon-rail" : ""}${isDetailPinned ? " plan-shell__body--detail-pinned" : ""}`}
              data-testid="plan-shell-body"
            >
              {/* Story 6.3 — same content as the old always-open left rail
                  (Episode 19), now shared between two rendering modes via
                  these two consts: rendered inline, stacked, before any
                  plan is analyzed (unchanged from before this story — a
                  first-time visitor needs the paste box immediately, not
                  behind an icon), and rendered inside the icon rail's
                  on-demand overlay panels once one is. `newPlanContent`'s
                  own `{analyzed && ...}` guard around the "New plan" clear
                  button already does the right thing in both places (no
                  button pre-analysis, shown once there's something to
                  clear) without a second conditional here. */}
              {(() => {
                const newPlanContent = (
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

                    {/* Story 6.3 — `rawText` (not just `initial?.rawText`,
                        the one-time share-link-recovery value) so a
                        PasteBox instance that remounts — the pre-analysis
                        inline view giving way to this icon-rail-hosted
                        one being the first and biggest such transition —
                        starts pre-filled with whatever was JUST analyzed,
                        not blank. A real bug this story's own e2e run
                        caught: without this, the auto-collapsed New Plan
                        panel came back empty on reopen, breaking the
                        story's own explicit "re-openable, to edit and
                        re-analyze" requirement the very first time it
                        actually mattered. */}
                    <PasteBox
                      onAnalyze={handleAnalyze}
                      initialText={rawText || initial?.rawText}
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

                    {error && (
                      <Notice severity="critical" data-testid="parse-error">
                        {error}
                      </Notice>
                    )}
                  </div>
                )

                if (!analyzed) {
                  // Pre-analysis: unchanged from before this story — the
                  // icon rail doesn't apply yet, there's nothing else
                  // competing for this space.
                  return (
                    <aside className="plan-shell__rail plan-shell__rail--left" data-testid="plan-shell-left-rail">
                      {newPlanContent}
                      <RecentPlansList plans={recentPlans} onSelect={handleAnalyze} onDelete={handleDeleteRecentPlan} onClearAll={handleClearAllRecentPlans} />
                    </aside>
                  )
                }

                return (
                  <IconRail
                    activePanel={activeRailPanel}
                    onSelectPanel={setActiveRailPanel}
                    newPlanContent={newPlanContent}
                    recentPlansContent={
                      <RecentPlansList
                        plans={recentPlans}
                        onSelect={handleAnalyze}
                        onDelete={handleDeleteRecentPlan}
                        onClearAll={handleClearAllRecentPlans}
                        hideOwnToggle
                      />
                    }
                    recentPlansCount={recentPlans.length}
                    findingsCount={findingsSummary.total}
                    findingsWorstSeverity={findingsSummary.worstSeverity}
                    isFindingsOpen={isFindingsDrawerOpen}
                    onToggleFindings={() => handleFindingsOpenChange(!isFindingsDrawerOpen)}
                  />
                )
              })()}

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

              {/* Story 6.3 — always renders once a plan is analyzed, at
                  every width (the retired narrow-shell tab switch used to
                  gate this on `activeShellTab === "graph"`; see this
                  file's own `activeRailPanel` comment for why that
                  mechanism no longer applies). */}
              {analyzed && activeStatement && (
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

                  {/* Episode 23, Story 23.3 — additive to the summary
                      sentence above, not a replacement: two different,
                      complementary views of the same underlying findings.
                      Scoped to normal (non-maximized) mode only — a
                      decision made explicitly, not left to CSS accident
                      (Episode 22's own edge-case tables set this
                      precedent): maximized mode's toolbar already has 5
                      other elements competing for the same top-of-viewport
                      space (statement dropdown, Beginner/Expert, Walk-me-
                      through, Findings, the maximize toggle itself — Story
                      22.1), and this card's own value (an at-a-glance
                      verdict on load) is squarely a normal-mode, first-
                      look concern, not something a user who's already
                      maximized to explore a large plan is reaching for. */}
                  {queryHealth && !isMaximized && <QueryHealthCard health={queryHealth} />}

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

                  {/* Episode 22, Story 22.1 — the whole graph pane (search
                      trigger, PlanGraph, and its own detail panel while
                      maximized) is the ONE element that toggles between
                      normal document-flow layout and a `position: fixed;
                      inset: 0` full-viewport overlay — the exact same DOM
                      subtree/React component instance either way, so
                      PlanGraph's own internal state (selection, pan/zoom,
                      collapse) is never reset by maximizing/restoring; only
                      this wrapper's own CSS class changes. */}
                  <div
                    className={`plan-shell__graph${isMaximized ? " plan-shell__graph--maximized" : ""}`}
                    data-testid="plan-shell-graph"
                  >
                    <div className="plan-shell__graph-toolbar">
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
                      {/* Confirmed with the user: maximize means filling the
                          whole browser viewport (a CSS overlay, not the real
                          Fullscreen API — see the episode's own feasibility
                          note). Keyboard-reachable (a real button) and
                          labeled for screen readers, matching every other
                          control in this app. */}
                      <button
                        type="button"
                        className="plan-shell__maximize-toggle"
                        data-testid="graph-maximize-toggle"
                        aria-pressed={isMaximized}
                        aria-label={isMaximized ? "Restore graph to normal size" : "Maximize graph to fill the screen"}
                        onClick={() => setIsMaximized((v) => !v)}
                      >
                        {isMaximized ? "Restore" : "Maximize"}
                      </button>
                    </div>

                    {/* Confirmed with the user: Findings, the Beginner/Expert
                        toggle, and Walk-me-through all stay reachable while
                        maximized — the app bar/left rail these normally live
                        in is visually covered by this fixed overlay, so this
                        is a second render location for the SAME controls/
                        state, not new behavior (the app bar's own copies,
                        just above, are unaffected and still work when not
                        maximized). A multi-statement batch also gets a new
                        compact dropdown here — the full statement tab strip
                        above is too wide for this chrome-minimized view. */}
                    {isMaximized && (
                      <div className="plan-shell__maximized-toolbar" data-testid="maximized-toolbar">
                        {analyzed.statements.length > 1 && (
                          <select
                            className="plan-shell__maximized-statement-select"
                            data-testid="maximized-statement-select"
                            aria-label="Switch statement"
                            value={activeStatementIndex}
                            onChange={(e) => switchToStatement(Number(e.target.value))}
                          >
                            {analyzed.statements.map((stmt, index) => (
                              <option key={stmt.label + index} value={index}>
                                {stmt.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="plan-shell__mode-toggle" role="group" aria-label="Detail level">
                          <button
                            type="button"
                            className="plan-shell__mode-toggle-button"
                            aria-pressed={!expertMode}
                            data-testid="maximized-mode-beginner"
                            onClick={() => setExpertMode(false)}
                          >
                            Beginner
                          </button>
                          <button
                            type="button"
                            className="plan-shell__mode-toggle-button"
                            aria-pressed={expertMode}
                            data-testid="maximized-mode-expert"
                            onClick={() => setExpertMode(true)}
                          >
                            Expert
                          </button>
                        </div>
                        <button
                          type="button"
                          className="plan-shell__app-bar-button"
                          data-testid="maximized-walkthrough-open"
                          onClick={() => setIsWalkthroughOpen(true)}
                        >
                          Walk me through it
                        </button>
                        <button
                          type="button"
                          className="plan-shell__app-bar-button"
                          data-testid="maximized-findings-toggle"
                          aria-pressed={isMaximizedFindingsOpen}
                          onClick={() => setIsMaximizedFindingsOpen((v) => !v)}
                        >
                          Issues
                        </button>
                      </div>
                    )}

                    {isMaximized && isMaximizedFindingsOpen && (
                      <div className="plan-shell__maximized-findings" data-testid="maximized-findings-panel">
                        <FindingsList sources={findingsSources} activeStatementIndex={activeStatementIndex} onSelectNode={handleSelectFinding} />
                      </div>
                    )}

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
                      // Stories 22.2 (DOM/SVG mode) + 22.3 (canvas mode) —
                      // PlanGraph now renders its own node-anchored popup
                      // itself in BOTH rendering modes when maximized (only
                      // it, or its CanvasPlanGraph child, can compute a
                      // node's on-screen position). Story 22.1's own interim
                      // overlay-variant fallback for canvas mode is gone —
                      // Story 22.3 gave it a real popup mechanism of its own.
                      nodeDetailVariant={isMaximized ? "popup" : "panel"}
                    />
                  </div>

                  {/* Story 6.3 — the findings drawer, docked at the bottom
                      of the canvas column (not the old permanent left
                      rail). Suppressed while maximized — Episode 22's own
                      separate maximized-mode Findings toggle/panel
                      (above, `isMaximizedFindingsOpen`) is untouched by
                      this story. Insets away from an open, un-pinned
                      detail panel (a fixed overlay anchored to the
                      viewport's right edge) so the two never clip or hide
                      each other in the bottom-right corner. */}
                  {!isMaximized && (
                    <FindingsDrawer
                      sources={findingsSources}
                      activeStatementIndex={activeStatementIndex}
                      onSelectNode={handleSelectFinding}
                      summary={findingsSummary}
                      isOpen={isFindingsDrawerOpen}
                      onOpenChange={handleFindingsOpenChange}
                      detailPanelOpen={Boolean(detailPanel) && !isDetailPinned}
                    />
                  )}
                </main>
              )}

              {/* Right rail: a true grid track above 1180px of the shell's
                  own width, an overlay-with-scrim below it — the
                  `detail-panel--in-shell` variant and this scrim compose to
                  do that; see detailPanel.css and planReaderPage.css. Always
                  mounted now (Episode 19) — empty until a node is opened,
                  same as before. Story 22.1: suppressed while maximized —
                  the graph pane above renders the SAME `detailPanel` state
                  itself in that mode (see its own comment just above), so
                  this rail would otherwise show a second, redundant copy of
                  the exact same panel underneath the maximized overlay. */}
              <aside className="plan-shell__rail plan-shell__rail--right" data-testid="plan-shell-right-rail">
                {/* Story 6.3 — overlay by default (`variant="overlay"`,
                    the always-`position: fixed` behavior every other
                    caller in this app already uses — never a reflow of
                    the canvas beside it), `variant="shell"` (the
                    pre-existing grid-track-above-1180px behavior) only
                    while pinned. `isPinned`/`onPinnedChange` are passed
                    unconditionally here since this IS the shell-context
                    caller the pin control is built for (see DetailPanel's
                    own doc comment for the other callers that omit both). */}
                {detailPanel && !isMaximized && (
                  <DetailPanel
                    node={detailPanel.node}
                    context={detailPanel.context}
                    onClose={detailPanel.onClose}
                    variant={isDetailPinned ? "shell" : "overlay"}
                    expertMode={expertMode}
                    onExpertModeChange={setExpertMode}
                    isPinned={isDetailPinned}
                    onPinnedChange={setIsDetailPinned}
                  />
                )}
              </aside>
              {/* Story 6.3 — the scrim now renders (and closes the panel
                  on click) whenever an UN-PINNED panel is open, at every
                  shell width — not gated to <1180px anymore, since
                  overlay-by-default is no longer a narrow-width-only
                  state. A pinned panel gets no scrim: it's a normal grid
                  track the user asked to keep visible, not something a
                  stray click on the canvas should dismiss. */}
              {detailPanel && !isMaximized && !isDetailPinned && (
                <div className="plan-shell__detail-scrim" data-testid="plan-shell-detail-scrim" onClick={detailPanel.onClose} />
              )}
            </div>
          )}

          {/* Episode 26, Story 26.4 — a new, permanent status bar at the
              shell's own bottom edge (the last element in the grid, not
              page-level like the old footer this replaces). "Permanent"
              means it renders even before any plan is analyzed — with
              just the branding chip, per this story's own edge case
              ("don't show fabricated zeros" for data that doesn't exist
              yet) — not gated behind `analyzed` the way every app-bar
              control above it is.
              Excluded from compare mode: Episode 14's comparison view is
              deliberately NOT part of the shell grid (see this file's own
              comment on `plan-reader-page__compare` above, Story 18.14's
              own follow-up) — a shell-grid element integrating with it is
              equally out of scope here, not a new decision.
              Maximized mode (Episode 22): deliberately NOT given special
              treatment to "stay visible above" the maximized overlay —
              `.plan-shell__graph--maximized`'s own `position: fixed;
              inset: 0` already covers the app-bar the exact same way
              (see that class's own comment); this stays consistent with
              that established, already-shipped precedent rather than
              inventing a second convention for one more element. */}
          {!compareMode && (
            <footer className="plan-shell__status-bar" data-testid="plan-shell-status-bar">
              <button
                type="button"
                className="plan-shell__status-bar-brand"
                aria-expanded={isAboutOpen}
                aria-label="About PlanReader"
                data-testid="status-bar-brand"
                onClick={() => setIsAboutOpen((v) => !v)}
              >
                <TreeStructure className="plan-shell__status-bar-brand-icon" weight="fill" aria-hidden="true" />
                PlanReader
              </button>
              {isAboutOpen && (
                // The old page footer's exact attribution sentence,
                // relocated here rather than discarded — an on-demand
                // disclosure now instead of an always-visible line, which
                // is what makes the chip itself meaningfully "clickable"
                // (this story's own AC) without a real destination URL to
                // link to (same disclosed gap the old footer's own
                // comment already named — a fabricated link would still
                // be worse than none).
                <p className="plan-shell__status-bar-about" role="status" data-testid="status-bar-about">
                  Built by Kiran, creator of the @scalingbackend execution-plan video series and blog post.
                </p>
              )}

              {analyzed && (
                // REAL BUG found via live verification (not just the AC's
                // own narrow-width checklist item): this sub-container is
                // where `overflow-x: auto` actually lives now — putting it
                // on the OUTER bar directly silently forced `overflow-y`
                // to `auto` too (never `visible`, per the CSS spec for a
                // single non-`visible` axis), clipping the brand chip's
                // own `bottom: 100%` popover above even though it was
                // genuinely in the DOM and toggling correctly. The brand
                // button (and its popover) stays in the outer bar's own
                // unclipped flex row; only the data items that actually
                // need to scroll at a narrow width live in here.
                <div className="plan-shell__status-bar-scroll">
                  <span className="plan-shell__status-bar-divider" aria-hidden="true" />
                  <span className="plan-shell__status-bar-item" data-testid="status-bar-engine">
                    {ENGINE_LABEL[analyzed.engine]}
                  </span>
                  <span className="plan-shell__status-bar-item" data-testid="status-bar-node-count">
                    {activeStatementNodes.length.toLocaleString("en-US")} nodes
                  </span>
                  {/* The SAME toggle the icon rail's own Issues button and
                      FindingsDrawer's own summary bar both drive
                      (`isFindingsDrawerOpen`/`handleFindingsOpenChange`)
                      — not a second, independently-drifting control. */}
                  <button
                    type="button"
                    className="plan-shell__status-bar-item plan-shell__status-bar-severity"
                    aria-pressed={isFindingsDrawerOpen}
                    aria-label={`${findingsSummary.total} issue${findingsSummary.total === 1 ? "" : "s"}: ${findingsSummary.critical} critical, ${findingsSummary.warning} warning${findingsSummary.warning === 1 ? "" : "s"}, ${findingsSummary.info} info — toggle the Issues panel`}
                    data-testid="status-bar-severity-counts"
                    onClick={() => handleFindingsOpenChange(!isFindingsDrawerOpen)}
                  >
                    <span className="plan-shell__status-bar-severity-count plan-shell__status-bar-severity-count--critical">
                      {findingsSummary.critical}
                    </span>
                    <span className="plan-shell__status-bar-severity-count plan-shell__status-bar-severity-count--warning">
                      {findingsSummary.warning}
                    </span>
                    <span className="plan-shell__status-bar-severity-count plan-shell__status-bar-severity-count--info">{findingsSummary.info}</span>
                  </button>
                  <span className="plan-shell__spacer" />
                  {/* The SAME lifted `expertMode` state as the app bar's
                      own toggle (Story 18.3) and the maximized-mode
                      toolbar's copy — a third reachable control, not a
                      third independent state. Reuses the app bar's own
                      `.plan-shell__mode-toggle` classes directly (not a
                      parallel copy) — matching that control's own
                      comment: the same lifted state should read as the
                      same kind of control everywhere it appears. */}
                  <div className="plan-shell__mode-toggle" role="group" aria-label="Detail level">
                    <button
                      type="button"
                      className="plan-shell__mode-toggle-button"
                      aria-pressed={!expertMode}
                      data-testid="status-bar-mode-beginner"
                      onClick={() => setExpertMode(false)}
                    >
                      Beginner
                    </button>
                    <button
                      type="button"
                      className="plan-shell__mode-toggle-button"
                      aria-pressed={expertMode}
                      data-testid="status-bar-mode-expert"
                      onClick={() => setExpertMode(true)}
                    >
                      Expert
                    </button>
                  </div>
                </div>
              )}
            </footer>
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
          // Story 20.6 — only meaningful once there's more than one
          // statement to disambiguate between; a single-statement plan's
          // walkthrough header is unchanged.
          statementLabel={analyzed && analyzed.statements.length > 1 ? activeStatement.label : undefined}
          // Story 20.6 — reuses the exact same focusNodeId channel `onExit`
          // above already feeds: pans/selects the current step's node in
          // the graph behind the dimmed overlay (and, as a bonus rather
          // than a problem, keeps the right-rail detail panel in sync with
          // whatever the walkthrough is currently narrating) as the reader
          // steps through, not only once on exit.
          onStepChange={setFocusNodeId}
        />
      )}

    </main>
  )
}
