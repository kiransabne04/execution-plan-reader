// Episode 7 acceptance criteria: "the privacy statement is visible directly
// at the paste box, not only in a footer/docs link" (the PEV2 case in
// docs/07-additional-tool-limitations.md — a technically-safe default lost
// user trust because the tool never said so where the trust decision gets
// made). Authored here now, ahead of the paste-box UI itself, so the
// wording is deliberate and reviewed once rather than invented ad hoc when
// that component finally gets built.

export const PRIVACY_STATEMENT_SHORT =
  "Nothing you paste ever leaves your browser. Parsing, analysis, and rendering all run locally — no signup, no server, no limit."

export const PRIVACY_STATEMENT_LONG =
  "Your plan is parsed and analyzed entirely in your browser — it's never sent to a server. " +
  "This is true by architecture, not just policy: this covers PlanReader's own code, though it can't " +
  "control browser extensions or other scripts running on the page. There's no signup and no limit on " +
  "how many plans you can check."
