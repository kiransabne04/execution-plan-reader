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
  /** 1-2 sentences, Beginner-mode default. */
  shortDefinition: string
  /** Fuller paragraph, Expert-mode default. */
  longDefinition: string
  /** General "this is often the right choice when...". */
  whenItsFine: string
  /** General "this is worth a second look when...". */
  whenToLookCloser: string
  /** Link into existing @scalingbackend content, when available. */
  learnMoreUrl?: string
}
