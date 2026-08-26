# Skill: Privacy Architecture

**Use this skill for any change anywhere in the codebase that could introduce a network call, add logging/telemetry, or touch error handling.** This is the single most important architectural boundary in the whole project — read this before touching `src/parsers/`, `src/rules/`, `src/graph/`, or anything shared/global (error boundaries, analytics setup, logging utilities).

## Source of truth

Full requirements: `docs/technical-spec.md` §6, `docs/prd.md` §4 (goals) and §8 (non-goals), `docs/episodes.md` Episode 7, `docs/07-additional-tool-limitations.md` §5 (the PEV2 trust case).

## The rule

**The rule-based path (parsing, normalization, rule evaluation, rendering) must never send plan content to a server.** This is not a policy or a promise to be careful about — it must be structurally true, and CI must verify it's true, every time.

## What counts as "plan content" for this purpose

- The raw pasted/uploaded plan text or file, in any format (JSON, XML, TEXT).
- Any extracted literal from it: table names, column names, filter values, query text.
- Derived data that could reconstruct meaningful fragments of the above (e.g. don't assume "just the operator types" is automatically safe if operator-type sequences plus row counts could be reverse-engineered into something identifying — use judgment, and when in doubt, don't send it).

**Structured rule-engine findings** (operator types, severities, relative costs — the `Warning[]` shape) are explicitly **not** plan content and are what gets sent in the opt-in LLM narrative mode (see `docs/technical-spec.md` §2). That boundary is deliberate — don't widen what's sent to the LLM endpoint without an explicit architecture discussion and a docs update first.

## Concrete requirements

1. **Zero outbound requests during the default rule-based flow.** No exceptions for "just analytics" or "just error reporting" — those are exactly the vectors that leak content by accident (see #2).
2. **Error messages and telemetry must never include raw pasted content.** A caught parse exception whose `.message` includes a snippet of the offending input, then gets sent to an error-tracking service, is a real and easy-to-introduce leak. Error messages should describe *structure* ("JSON parse failed at position 412," "expected `ShowPlanXML` element, none found") not content.
3. **The LLM narrative mode opt-in must be a hard, tested default.** The default state (opted out) is asserted in CI — a config or deploy mistake that flips this default should fail the build, not ship silently.
4. **The privacy statement lives at the paste box in the UI, not only in a docs/footer link.** This is a product requirement, not just an engineering one — see the PEV2 case in `docs/07-additional-tool-limitations.md`: a team distrusted a technically-safe tool because its *default*, as experienced by a first-time user, wasn't clearly communicated at the moment the trust decision gets made.

## Testing checklist for any change touching this boundary

- [ ] Automated test: intercept all network calls during a full rule-based-path flow (paste → parse → visualize → view warnings) across all three engines; assert zero requests contain plan text, literals, or identifiers.
- [ ] Automated test: assert the LLM narrative mode's default state is "off" — this test should be part of the standard suite, not a one-time manual check.
- [ ] Any new error-handling code: confirm the error message/logged payload contains no raw input, only structural metadata.
- [ ] Any new analytics/telemetry call: confirm it's aggregate-only (counts/categories, e.g. "SQL Server XML root-detection failure") and never includes per-plan content, consistent with the aggregate-only monitoring approach used in soft-launch validation (Episode 12).

## When you're unsure

If a change seems like it might touch this boundary and it's not obvious from this skill whether it's safe, don't guess — flag it explicitly and treat it as requiring the "architecture discussion" mentioned above, rather than shipping it and hoping the tests catch it.
