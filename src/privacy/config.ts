// Episode 7 edge case: "LLM narrative mode accidentally becoming the
// default (config/deploy mistake) would silently break the core privacy
// promise." Episode 10 (the LLM narrative feature) doesn't exist yet — this
// constant is established now, ahead of that feature, specifically so its
// default can never silently flip without a test failing. When Episode 10
// is built, its opt-in UI reads this constant rather than hardcoding its
// own default.

/** Hard default: the opt-in LLM narrative mode starts OFF. Must stay
 * `false` — see privacy-architecture skill and the test asserting this. */
export const LLM_NARRATIVE_MODE_DEFAULT_ENABLED = false as const
