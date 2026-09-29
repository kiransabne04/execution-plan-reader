import { EMPTY_STATE_HEADING, HERO_ENGINES, HERO_SAMPLE_CTA, HERO_TAGLINE } from "./emptyStateCopy"
import { SAMPLE_PLANS_ANCHOR_ID } from "./homepageContent"

// Compact strip above the analyzer, shown only before a plan is loaded, so
// the paste box stays in the same first viewport. Holds the page's only
// <h1> (moved here from the empty canvas). The sample link scrolls rather
// than setting a hash: the URL fragment carries share-link plans.
function scrollToSamplePlans() {
  document.getElementById(SAMPLE_PLANS_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "center" })
}

export function LightHero() {
  return (
    <div className="light-hero" data-testid="light-hero">
      <div className="light-hero__text">
        <h1 className="light-hero__heading">{EMPTY_STATE_HEADING}</h1>
        <p className="light-hero__tagline">{HERO_TAGLINE}</p>
      </div>
      <div className="light-hero__meta">
        <ul className="light-hero__engines" aria-label="Supported databases">
          {HERO_ENGINES.map((engine) => (
            <li key={engine}>{engine}</li>
          ))}
        </ul>
        <button type="button" className="light-hero__sample" data-testid="hero-sample-link" onClick={scrollToSamplePlans}>
          {HERO_SAMPLE_CTA}
        </button>
      </div>
    </div>
  )
}
