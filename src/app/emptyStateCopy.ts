// User-directed SEO follow-up: single source of truth for the empty-state
// H1/subheading, shared between the real React empty state
// (PlanReaderPage.tsx) and the static SEO snapshot baked directly into
// index.html (see that file's own comment on why a static copy exists at
// all — this is a 100% client-rendered SPA; the raw HTML response is
// otherwise `<div id="root"></div>`, invisible content to any crawler that
// doesn't execute JS). index.html can't import a TS module, so its own
// copy has to stay a literal, hardcoded string — but
// `seoSnapshot.test.ts` imports these same constants and asserts
// index.html's literal text still matches them exactly, so the two can
// never silently drift apart the way two independently-typed copies could.
export const EMPTY_STATE_HEADING = "Analyze PostgreSQL, SQL Server & Snowflake Execution Plans"

export const EMPTY_STATE_SUBHEADING =
  "Find expensive scans, bad estimates, spills, inefficient joins, poor pruning and other performance problems — entirely in your browser."
