import { useCallback, useState } from "react"
import { PasteBox } from "./PasteBox"
import { ShareLinkButton } from "./ShareLinkButton"
import { analyzePlanText, type AnalyzedPlan } from "./analyzePlan"
import { decodeShareLink } from "./shareLink"
import { HERO_HEADLINE, HERO_SUBHEADLINE, SUPPORTED_ENGINES } from "./positioningCopy"
import { PlanGraph } from "../graph"
import { PlanParseError } from "../parsers/normalize"
import "./planReaderPage.css"

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

  const handleAnalyze = useCallback((text: string) => {
    setRawText(text)
    try {
      const result = analyzePlanText(text)
      setAnalyzed(result)
      setActiveStatementIndex(0)
      setError(null)
    } catch (err) {
      setAnalyzed(null)
      // PlanParseError messages are already structural-only (never echo raw
      // pasted content) — see the privacy-architecture skill — so it's safe
      // to show err.message directly.
      setError(err instanceof PlanParseError ? err.message : "Something went wrong reading this plan.")
    }
  }, [])

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

      <PasteBox onAnalyze={handleAnalyze} initialText={initial?.rawText} />

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
            <ShareLinkButton rawText={rawText} />
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

          <div className="plan-reader-page__graph">
            <PlanGraph root={activeStatement.root} context={activeStatement.context} />
          </div>
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
