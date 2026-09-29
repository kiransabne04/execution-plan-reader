// Episode SEO-03, Story 03.1 — standalone PostgreSQL product landing page.
// Purely presentational; all copy lives in postgresLandingContent.ts
// (single source of truth, also reused by the crawlable static snapshot in
// postgresql-execution-plan-analyzer.html — see that file's own comment).
// No second copy of the analyzer/paste box lives here — the Analyzer CTA
// and "Try a sample plan" CTA are plain links back to the real app at `/`.
import {
  ANALYZER_CTA_HREF,
  ANALYZER_CTA_TEXT,
  DEEP_LEARNING_BODY,
  DEEP_LEARNING_HEADING,
  DEEP_LEARNING_LINK_HREF,
  DEEP_LEARNING_LINK_TEXT,
  EXAMPLE_FINDING_BODY,
  EXAMPLE_FINDING_HEADING,
  H1,
  HOW_TO_GENERATE_HEADING,
  HOW_TO_GENERATE_JSON_COMMAND,
  HOW_TO_GENERATE_JSON_LABEL,
  HOW_TO_GENERATE_TEXT_COMMAND,
  HOW_TO_GENERATE_TEXT_LABEL,
  INTRO,
  PRIVACY_POINTS,
  SUPPORTED_INPUT_FORMATS,
  TRY_SAMPLE_BODY,
  TRY_SAMPLE_CTA_HREF,
  TRY_SAMPLE_CTA_TEXT,
  TRY_SAMPLE_HEADING,
  WHAT_IT_DETECTS,
  WHAT_PLANREADER_ANALYZES,
} from "./postgresLandingContent"
import "./productLandingPage.css"

export function PostgresLandingPage() {
  return (
    <div className="landing-page" data-testid="postgres-landing-page">
      <header className="landing-page__hero">
        <h1>{H1}</h1>
        <p>{INTRO}</p>
        <a className="landing-page__cta" data-testid="analyzer-cta" href={ANALYZER_CTA_HREF}>
          {ANALYZER_CTA_TEXT}
        </a>
      </header>

      <section className="landing-section" aria-labelledby="landing-what-analyzes">
        <h2 id="landing-what-analyzes">What PlanReader analyzes</h2>
        <p>{WHAT_PLANREADER_ANALYZES}</p>
      </section>

      <section className="landing-section" aria-labelledby="landing-input-formats">
        <h2 id="landing-input-formats">Supported input formats</h2>
        <ul>
          {SUPPORTED_INPUT_FORMATS.map((format) => (
            <li key={format.label}>
              <code>{format.label}</code> — {format.description}
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="landing-what-it-detects">
        <h2 id="landing-what-it-detects">What it detects</h2>
        <ul>
          {WHAT_IT_DETECTS.map((issue) => (
            <li key={issue.ruleId}>{issue.label}</li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="landing-example-finding">
        <h2 id="landing-example-finding">{EXAMPLE_FINDING_HEADING}</h2>
        <p>{EXAMPLE_FINDING_BODY}</p>
      </section>

      <section className="landing-section" aria-labelledby="landing-privacy">
        <h2 id="landing-privacy">Privacy</h2>
        <ul>
          {PRIVACY_POINTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="landing-how-to-generate">
        <h2 id="landing-how-to-generate">{HOW_TO_GENERATE_HEADING}</h2>
        <p>{HOW_TO_GENERATE_JSON_LABEL}</p>
        <pre>
          <code>{HOW_TO_GENERATE_JSON_COMMAND}</code>
        </pre>
        <p>{HOW_TO_GENERATE_TEXT_LABEL}</p>
        <pre>
          <code>{HOW_TO_GENERATE_TEXT_COMMAND}</code>
        </pre>
      </section>

      <section className="landing-section" aria-labelledby="landing-try-sample">
        <h2 id="landing-try-sample">{TRY_SAMPLE_HEADING}</h2>
        <p>{TRY_SAMPLE_BODY}</p>
        <a className="landing-page__cta" data-testid="try-sample-cta" href={TRY_SAMPLE_CTA_HREF}>
          {TRY_SAMPLE_CTA_TEXT}
        </a>
      </section>

      <section className="landing-section" aria-labelledby="landing-deep-learning">
        <h2 id="landing-deep-learning">{DEEP_LEARNING_HEADING}</h2>
        <p>
          {DEEP_LEARNING_BODY}{" "}
          <a href={DEEP_LEARNING_LINK_HREF} rel="noopener noreferrer">
            {DEEP_LEARNING_LINK_TEXT}
          </a>
        </p>
      </section>

      <footer className="landing-page__footer">
        <a href={ANALYZER_CTA_HREF}>&larr; Back to PlanReader</a>
      </footer>
    </div>
  )
}
