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

/** The Episode 7 edge case: "browser extensions or third-party scripts that
 * could read page content" are outside PlanReader's control, and that
 * caveat must be stated in the UI's privacy copy, not just documented in a
 * skill file nobody using the tool ever sees. Kept as its own short line
 * (rather than folding callers into PRIVACY_STATEMENT_LONG, which repeats
 * the "never leaves your browser" claim SHORT already made) so the paste
 * box can show the primary claim plus this caveat without redundancy. */
export const PRIVACY_CAVEAT_NOTE =
  "This guarantee covers PlanReader's own code — it can't control browser extensions or other scripts running on the page."
