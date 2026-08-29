import { useCallback, useEffect, useMemo, useState } from "react"
import { PasteBox } from "./PasteBox"
import { ComparePasteBox } from "./ComparePasteBox"
import { ShareLinkButton } from "./ShareLinkButton"
import { RestoreSessionBanner } from "./RestoreSessionBanner"
import { RecentPlansList } from "./RecentPlansList"
import { analyzePlanText, type AnalyzedPlan } from "./analyzePlan"
import { decodeShareLink } from "./shareLink"
import { HERO_HEADLINE, HERO_SUBHEADLINE, SUPPORTED_ENGINES } from "./positioningCopy"
import { PlanGraph, FindingsList, PlanComparisonView } from "../graph"
import { PlanParseError, collectNodes } from "../parsers/normalize"
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
        <section className="plan-reader-page__result" data-testid="plan-result">
          <div className="plan-reader-page__result-header">
            <span className="plan-reader-page__engine-badge" data-testid="detected-engine-badge">
              {ENGINE_LABEL[analyzed.engine]}
            </span>
            <div className="plan-reader-page__result-header-actions">
              {!compareMode && (
                <button
                  type="button"
                  className="compare-toggle"
                  data-testid="compare-toggle"
                  onClick={() => setCompareMode(true)}
                >
                  Compare with another plan
                </button>
              )}
              <ShareLinkButton rawText={rawText} />
            </div>
          </div>

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

          <p className="plan-reader-page__summary" data-testid="plan-summary">
            {activeStatement.summary.text}
          </p>

          {compareMode ? (
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
            <>
              <FindingsList root={activeStatement.root} onSelectNode={setFocusNodeId} />

              <div className="plan-reader-page__graph">
                <PlanGraph
                  root={activeStatement.root}
                  context={activeStatement.context}
                  focusNodeId={focusNodeId}
                  onFocusHandled={() => setFocusNodeId(undefined)}
                />
              </div>
            </>
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
