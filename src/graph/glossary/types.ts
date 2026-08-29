// Episode 6 Story 6.2 — operator glossary data model. See
// .claude/skills/operator-glossary-content/SKILL.md before editing anything
// in this directory: a glossary entry is general, static, engine-and-plan-
// independent education about an operator TYPE — never a specific finding
// about one node in one plan (that's a rule engine `Warning`).

export interface OperatorGlossaryEntry {
  /** Matches the normalized taxonomy (plan-normalization skill) — the map key. */
  operatorType: string
  /** "Sequential Scan", not the raw engine label. */
  displayName: string
  /** 1-2 sentences. Episode 18, Story 18.7 (spec §5 `1f`): rendered alone
   * as Expert mode's collapsed-to-one-line education — an expert already
   * knows what this operator is. (Originally documented as the Beginner-
   * mode default when Story 6.2 shipped this field; the redesign spec
   * reversed that — see OperatorEducation.tsx's own comment for the full
   * account, and the operator-glossary-content skill's "if this skill and
   * those docs disagree, the docs win" instruction for why this comment
   * itself was updated rather than left stale.) */
  shortDefinition: string
  /** Fuller paragraph. Story 18.7: rendered as Beginner mode's "What this
   * does" text (a beginner needs the fuller teaching), alongside
   * `whenItsFine`/`whenToLookCloser` below — see `shortDefinition`'s own
   * comment for why this reverses Story 6.2's original field-level intent. */
  longDefinition: string
  /** General "this is often the right choice when...". */
  whenItsFine: string
  /** General "this is worth a second look when...". */
  whenToLookCloser: string
  /** Link into existing @scalingbackend content, when available. */
  learnMoreUrl?: string
}
