# PlanReader — Landing Page Positioning Brief

## The disambiguation problem

"PlanReader" reads as generic outside a database context — it could plausibly be a financial-planning app, a document reader, a project-planning tool, or a fitness/meal-plan app. The pattern that generically-named dev tools use to solve this is consistent: front-load the *category* in the very first words a person or a crawler sees (hero headline, title tag, meta description), then use the subheadline to name the concrete input/output so intent is unambiguous within seconds — never rely on the name alone to carry meaning. The category noun ("execution plan") has to appear before any scroll, any click, and ideally before the fold.

## Recommended hero headline

**"Paste your database execution plan. Get a plain-English explanation."**

This leads with the exact noun phrase ("execution plan") a confused developer would already have in their head from an error message, a Slack thread, or a senior engineer's advice — it mirrors their own internal language rather than introducing new terminology.

## Recommended subheadline

**"Free, no signup. Works with Postgres, SQL Server, and Snowflake — paste your plan, see a visual breakdown of what's slow and why."**

This does three jobs at once: kills signup-friction anxiety immediately (the #1 objection every competitor's pricing/signup page has to overcome), names the supported engines so a visitor self-qualifies in one glance, and previews the output format (visual + explanation) so expectations are set before they paste anything.

## Recommended meta title

`PlanReader — Explain Any Database Execution Plan in Plain English`

Kept under ~60 characters for search-result display, leads with the brand name (for people who already know it, e.g. return visitors or referral clicks) immediately followed by the category-clarifying phrase.

## Recommended meta description

`Paste a raw Postgres, SQL Server, or Snowflake execution plan and get a free, plain-English explanation plus a visual node-graph — no signup, nothing stored.`

Under ~160 characters, repeats the engine names (people search "postgres explain plan visualizer" or "snowflake query profile explained" far more often than "PlanReader"), and states the privacy stance explicitly since that's a recurring trust concern found across every competitor's own docs and support content.

## Recommended schema.org structured data

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "PlanReader",
  "applicationCategory": "DeveloperApplication",
  "applicationSubCategory": "Database Performance Tool",
  "operatingSystem": "Any (web-based)",
  "url": "https://planreader.dev",
  "description": "A free, no-signup web tool that explains raw database execution plans (Postgres, SQL Server, Snowflake) in plain English, with an interactive node-graph visualization of the plan tree.",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "Plain-English explanation of execution plans",
    "Interactive node-graph visualization",
    "Support for Postgres, SQL Server, and Snowflake",
    "No signup required",
    "Client-side, privacy-preserving parsing"
  ],
  "creator": {
    "@type": "Person",
    "name": "Kiran Sabne"
  }
}
```

`applicationSubCategory` and the explicit `"price": "0"` offer are the two fields most likely to earn better SERP treatment (rich result eligibility, "free" signaling) for a tool competing against paid entries like pgMustard and EverSQL in the same search results.

## On-page disambiguation checklist (beyond hero/meta)

- First `<h1>` on the page must contain "execution plan," not just "PlanReader" — screen readers, SEO crawlers, and skimming humans all benefit from this being redundant with the headline rather than relying on it alone.
- The paste box's placeholder text should show a truncated real example (e.g. the first couple of lines of a Postgres JSON plan) so the input format is self-evident without reading instructions — this also does double duty as an implicit "yes, this is the right kind of tool for what you have" confirmation.
- Engine logos/names (Postgres elephant, SQL Server, Snowflake) visible above the fold, since a visitor arriving from a Snowflake-specific search needs to confirm relevance in under two seconds — this is the single fastest disambiguation signal available, faster than reading copy.
- Footer/about section should explicitly connect PlanReader to Kiran's existing execution-plan video series and blog post, both for content-funnel purposes and because it signals real domain credibility (a generic-sounding name benefits disproportionately from an identifiable, credentialed author standing behind it) to a skeptical first-time visitor deciding whether to paste something sensitive.
- **Privacy statement belongs at the paste box, not just in a footer/docs link.** A real case from a close competitor (PEV2) is instructive: a team refused to use the hosted tool for internal plans even after confirming it was technically capable of running entirely locally, purely because the version they'd naturally land on stored plans server-side by default, and that default was what shaped their trust decision — not the tool's actual capability. The lesson: don't rely on a privacy policy page to carry this. A one-line, plainly worded statement ("Nothing you paste here is sent anywhere or stored — this runs entirely in your browser.") should sit directly above or beside the paste box itself, visible before the first paste, since that's the moment the trust decision actually gets made.
