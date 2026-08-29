import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { PasteBox } from "./PasteBox"
import { ComparePasteBox } from "./ComparePasteBox"
import { ShareLinkButton } from "./ShareLinkButton"
import { RestoreSessionBanner } from "./RestoreSessionBanner"
import { RecentPlansList } from "./RecentPlansList"
import { analyzePlanText, type AnalyzedPlan } from "./analyzePlan"
import { decodeShareLink } from "./shareLink"
import { HERO_HEADLINE, HERO_SUBHEADLINE, SUPPORTED_ENGINES } from "./positioningCopy"
import { PlanGraph, FindingsList, PlanComparisonView, DetailPanel } from "../graph"
import { PlanParseError, collectNodes, type PlanNode } from "../parsers/normalize"
import type { PlanContext } from "../rules/types"
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

  // Episode 18, Story 18.2 — the app shell's right rail: PlanGraph reports
  // the currently-open node's panel contents here instead of rendering
  // `<DetailPanel>` itself (see PlanGraph.tsx's `externalDetailPanel`),
  // since a true grid-track panel has to be a sibling of the rails, not
  // nested three levels deep inside PlanGraph's own DOM. `onClose` below
  // IS PlanGraph's own internal `closePanel` — focus-restoration to the
  // triggering card still works correctly even though the panel now
  // mounts elsewhere in the tree.
  const [detailPanel, setDetailPanel] = useState<{ node: PlanNode; context: PlanContext; onClose: () => void } | undefined>(undefined)

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
  const shellRef = useRef<HTMLElement>(null)
  const [isNarrowShell, setIsNarrowShell] = useState(false)
  // Which tab shows at narrow widths. Defaults to "graph" — this
  // breakpoint is tablet-territory, which can still usefully show a
  // graph; "Findings lead, not the graph" is specifically the true-mobile
  // (620px, Story 18.12) rule, not this one.
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

  // Story 18.2's shell only exists once a plan is analyzed and compare
  // mode isn't active (the comparison view isn't part of this grid — see
  // Story 18.14) — re-observe whenever that flips true so the ref (null
  // until the section actually mounts) gets attached.
  const shellMounted = Boolean(analyzed && activeStatement && !compareMode)
  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setIsNarrowShell(entry.contentRect.width < NARROW_SHELL_BREAKPOINT_PX)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [shellMounted])

  const handleDetailPanelChange = useCallback(
    (panel: { node: PlanNode; context: PlanContext; onClose: () => void } | undefined) => setDetailPanel(panel),
    [],
  )

  return (
    <main className="plan-reader-page">
      {/* Episode 8 Story 8.1: hero headline/subheadline/engine names must be
          visible without scrolling, on both desktop and mobile, and must
          never be hidden behind a loading state — this is plain, immediately
          rendered JSX with no async/lazy gate in front of it, and the exact
          wording comes from the reviewed positioning brief (positioningCopy.ts). */}
      <header className="plan-reader-page__hero">
        <h1 className="plan-reader-page__title">{HERO_HEADLINE}</h1>
        <p className="plan-reader-page__tagline">{HERO_SUBHEADLINE}</p>
        <ul className="plan-reader-page__engine-list" aria-label="Supported database engines">
          {SUPPORTED_ENGINES.map((engine) => (
            <li key={engine} className="plan-reader-page__hero-engine-badge">
              {engine}
            </li>
          ))}
        </ul>
      </header>

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
        <p className="plan-reader-page__error" role="alert" data-testid="parse-error">
          {error}
        </p>
      )}

      {analyzed && activeStatement && (
        // Episode 18, Story 18.2: `.plan-shell` is a `container-type:
        // inline-size` context — every breakpoint below (the app bar's own
        // gaps, the 1180px detail-panel switch, the 860px findings/graph
        // tab switch) measures against THIS element's width, not the
        // viewport, so the shell behaves the same embedded or full-page
        // (spec §2). `ref`/`data-testid="plan-result"` kept on the same
        // element existing tests already target.
        <section ref={shellRef} className="plan-reader-page__result plan-shell" data-testid="plan-result">
          <header className="plan-shell__app-bar">
            <span className="plan-shell__brand">PlanReader</span>
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
                (passed down below) and, per spec §2, Story 18.9's
                walkthrough once that exists. "Walk me through it" stays a
                disabled placeholder — that's 18.9's own job. */}
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
            <button type="button" className="plan-shell__app-bar-button" disabled title="Guided walkthrough — Story 18.9">
              Walk me through it
            </button>
            {!compareMode && (
              <button type="button" className="compare-toggle" data-testid="compare-toggle" onClick={handleEnterCompareMode}>
                Compare with another plan
              </button>
            )}
            <ShareLinkButton rawText={rawText} />
            {/* Spec §2: "Share and Export drop to icon-only before
                wrapping" — deferred until real icon assets exist (Story
                18.4 introduces the icon set this app bar would draw from);
                both stay full-width buttons at every width until then. */}
            <button type="button" className="plan-shell__app-bar-button" disabled title="PNG export — Story 18.11">
              Export
            </button>
          </header>

          {analyzed.queryTextRedacted && (
            <p className="plan-reader-page__note">Query text redacted by account policy.</p>
          )}

          {analyzed.statements.length > 1 && (
            <div className="plan-reader-page__statement-tabs" role="tablist" aria-label="Statements in this batch">
              {analyzed.statements.map((stmt, index) => (
                <button
                  key={stmt.label + index}
                  type="button"
                  role="tab"
                  aria-selected={index === activeStatementIndex}
                  className="plan-reader-page__statement-tab"
                  onClick={() => setActiveStatementIndex(index)}
                >
                  {stmt.label}
                </button>
              ))}
            </div>
          )}

          {compareMode ? (
            // Episode 14's comparison view is deliberately NOT part of the
            // shell grid below — Story 18.14 owns restyling it onto this
            // shell; spec §8 itself was written before Episode 14 shipped
            // this feature (see this episode's own goal note). Unchanged
            // from before this story.
            <div className="plan-reader-page__compare" data-testid="plan-reader-compare-section">
              {!comparePlan && <ComparePasteBox onAnalyze={handleCompareAnalyze} onCancel={handleStopComparing} />}

              {compareError && (
                <p className="plan-reader-page__error" role="alert" data-testid="compare-parse-error">
                  {compareError}
                </p>
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
              {/* Left rail (spec §2): "Plan input ... over Findings." The
                  plan-input half of this rail — a collapsed source preview
                  alongside the paste form — is Story 18.5's job (it owns
                  rebuilding the input experience wholesale); PasteBox stays
                  in its current pre-shell position above until then. Below
                  860px this rail becomes the "Findings" tab instead of a
                  side-by-side column — see the tablist below. */}
              {(!isNarrowShell || activeShellTab === "findings") && (
                <aside className="plan-shell__rail plan-shell__rail--left" data-testid="plan-shell-left-rail">
                  <FindingsList root={activeStatement.root} onSelectNode={setFocusNodeId} />
                </aside>
              )}

              {isNarrowShell && (
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

              {(!isNarrowShell || activeShellTab === "graph") && (
                <main className="plan-shell__canvas" data-testid="plan-shell-canvas">
                  <p className="plan-shell__summary" data-testid="plan-summary">
                    {activeStatement.summary.text}
                  </p>

                  {/* Spec §2's metrics strip also calls for a collapsed-
                      node count and a colour-legend — both read PlanGraph's
                      own internal collapse state / its metric-scale
                      encoding, which belong with Story 18.4's node-encoding
                      work (a legend is meaningless without the encoding it
                      explains), not this story's shell-structure scope.
                      Node count and the plain-language caption are real,
                      shell-appropriate metrics and are included now. */}
                  <div className="plan-shell__metrics-strip" data-testid="plan-shell-metrics">
                    <span>{collectNodes(activeStatement.root).length.toLocaleString("en-US")} nodes</span>
                    <span>Width = rows · Arrows = execution order</span>
                  </div>

                  <div className="plan-shell__graph">
                    <PlanGraph
                      root={activeStatement.root}
                      context={activeStatement.context}
                      focusNodeId={focusNodeId}
                      onFocusHandled={() => setFocusNodeId(undefined)}
                      externalDetailPanel
                      onDetailPanelChange={handleDetailPanelChange}
                    />
                  </div>
                </main>
              )}

              {/* Right rail: a true grid track above 1180px of the shell's
                  own width, an overlay-with-scrim below it — the
                  `detail-panel--in-shell` variant and this scrim compose to
                  do that; see detailPanel.css and planReaderPage.css. */}
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
