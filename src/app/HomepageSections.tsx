// Episode SEO-02, Story 02.2 — homepage content sections rendered below the
// analyzer shell: Supported Databases -> What PlanReader Detects -> Why
// PlanReader -> How It Works -> Privacy -> Try an Example -> Learn More ->
// FAQ. Purely presentational; all copy lives in homepageContent.ts (single
// source of truth, also reused by the crawlable static snapshot in
// index.html — see that file's own comment).
//
// Renders as a normal-flow sibling AFTER `.plan-reader-page` (see
// PlanReaderPage.tsx's top-level return), not inside it — the shell itself
// stays exactly one viewport tall and internally scrolling (spec §2b:
// "only the rails and panel scroll"), while THIS content lives in the
// page's own normal scroll below it (index.css's `#root` is a `min-height`
// floor now, not a `height` ceiling, specifically to allow this).
import {
  FAQ_ITEMS,
  HOW_IT_WORKS,
  LEARN_MORE_BODY,
  PRIVACY_POINTS,
  SAMPLE_PLANS_ANCHOR_ID,
  SUPPORTED_DATABASES,
  TRY_AN_EXAMPLE_BODY,
  TRY_AN_EXAMPLE_CTA,
  TRY_AN_EXAMPLE_HEADING,
  WHAT_IT_DETECTS,
  WHY_PLANREADER,
} from "./homepageContent"
import "./homepageSections.css"

function scrollToSamplePlans() {
  document.getElementById(SAMPLE_PLANS_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "center" })
}

export function HomepageSections() {
  return (
    <div className="homepage-sections" data-testid="homepage-sections">
      <section className="homepage-section" aria-labelledby="homepage-supported-databases">
        <h2 id="homepage-supported-databases">Supported Databases</h2>
        <div className="homepage-section__engines">
          {SUPPORTED_DATABASES.map((db) => (
            <div className="homepage-section__engine-card" key={db.engine}>
              <h3>
                <a href={db.href}>{db.engine}</a>
              </h3>
              <p>{db.format}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-what-it-detects">
        <h2 id="homepage-what-it-detects">What PlanReader Detects</h2>
        <ul>
          {WHAT_IT_DETECTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-why-planreader">
        <h2 id="homepage-why-planreader">Why PlanReader</h2>
        <ul>
          {WHY_PLANREADER.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-how-it-works">
        <h2 id="homepage-how-it-works">How It Works</h2>
        <ol className="homepage-section__steps">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title}>
              <span className="homepage-section__step-number" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-privacy">
        <h2 id="homepage-privacy">Privacy</h2>
        <ul>
          {PRIVACY_POINTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-try-an-example">
        <h2 id="homepage-try-an-example">{TRY_AN_EXAMPLE_HEADING}</h2>
        <p>{TRY_AN_EXAMPLE_BODY}</p>
        <button type="button" className="homepage-section__cta" data-testid="try-an-example-cta" onClick={scrollToSamplePlans}>
          {TRY_AN_EXAMPLE_CTA}
        </button>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-learn-more">
        <h2 id="homepage-learn-more">Learn More</h2>
        <p>{LEARN_MORE_BODY}</p>
      </section>

      <section className="homepage-section" aria-labelledby="homepage-faq">
        <h2 id="homepage-faq">FAQ</h2>
        <dl className="homepage-section__faq">
          {FAQ_ITEMS.map((item) => (
            <div className="homepage-section__faq-item" key={item.question}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
