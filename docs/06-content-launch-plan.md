# PlanReader — Content & Launch Plan

## 1. How this fits existing @scalingbackend content pillars

Kiran already has a 3-part video series and a companion long-form blog post on reading execution plans — this is not a cold start. PlanReader's job is to become the *interactive companion* to content that currently exists only as static explanation. The relationship should run in both directions:

- **Content → tool**: Every mention of "paste your plan here to see it visually" in the existing video series/blog post becomes a literal, working link to planreader.dev once it launches — retroactively updating that content turns already-indexed, already-ranking pages into a durable acquisition channel for the tool, with zero new content-production cost.
- **Tool → content**: Every rule-engine warning in PlanReader (see Technical Spec §2) that has a corresponding concept in the existing series links back to the relevant video timestamp or blog section — e.g. a "sequential scan on large table" warning links to whichever part of the series covers scan types. This makes the existing content pillar the canonical "learn more" destination rather than writing new explainer copy from scratch, directly honoring the constraint to reuse existing material.

## 2. Pre-launch content prep

- Audit the existing video series and blog post for every distinct concept/operator type covered (scan types, join types, cost estimation, row estimate mismatches, etc.) and map each one to the rule engine's warning categories — this produces both the linking map above and a gap list of concepts the rule engine covers that the existing content doesn't yet, which is useful input for future content topics.
- Update the blog post with a short "try it yourself" callout once the tool is live, pointing at planreader.dev with a live example plan pre-loaded via URL parameter if the architecture supports it (a nice, low-effort touch: a direct link that opens the tool with a specific example plan already parsed, matching whatever plan the blog post is walking through).

## 3. Launch sequencing

1. **Soft launch**: Ship MVP (Postgres, SQL Server, Snowflake; rule-based explanations; node-graph) quietly, link it from the existing blog post and video descriptions first. This validates parsing robustness against real-world pasted plans from an audience that already trusts the content, before wider exposure.
2. **Community launch**: Once soft-launch usage surfaces and fixes the inevitable parser edge cases, post to the communities most likely to both use and critique it usefully — r/PostgreSQL, r/SQLServer, r/dataengineering, and Hacker News (Show HN). The competitive analysis shows these are exactly the communities that organically championed Depesz and PEV2 in their early days, so a genuinely useful free tool in this space has real precedent for organic pickup rather than needing paid promotion.
3. **@scalingbackend content tie-in**: A short-form piece (Instagram) demoing the "paste plan → see plain-English answer" moment in under 30 seconds — this is the single most demo-able, screenshot-and-share-friendly moment the tool has, since it's a visible before/after (wall of text → clear visual) rather than something that needs explaining.

## 4. Funnel messaging (non-pushy, by design)

Per the PRD's non-goals, PlanReader must never feel like a lead-gen trap. The funnel touchpoints should be:
- Contextual, not interstitial — a small, dismissible callout tied to a *specific* finding (e.g., next to a Postgres bloat/vacuum-related warning: "pgsuite checks for this automatically across your whole database →"), not a generic banner shown to everyone regardless of what they pasted.
- Never blocking — the free tool's core value (explanation + visualization) must be fully usable with every funnel callout ignored or an ad-blocker-style extension hiding them entirely.
- Framed as "here's what handles this on an ongoing basis," not "upgrade now" — this matches how EverSQL and Postgres.ai anchor their own free-tool-to-paid-product transitions (per the competitive research): the free layer solves the one-off problem completely on its own; the paid product solves the *recurring* version of that same problem, which is a genuinely different value proposition rather than an artificially gated version of the same one.

## 5. Post-launch content loop

Once real usage data exists (see PRD success metrics — engine mix, common warning types), that data itself becomes future content: "the 5 most common Postgres plan mistakes, based on real plans people pasted into PlanReader" is exactly the kind of aggregate-insight piece that performs well for @scalingbackend and reinforces the tool's credibility without needing new invented examples, while never touching or storing any individual person's actual plan content (aggregate warning-type counts only, consistent with the privacy stance in the Technical Spec).
