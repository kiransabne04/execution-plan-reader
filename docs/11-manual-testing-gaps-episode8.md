# PlanReader — Manual Testing Gaps (post–Episode 8)

Found during manual testing after Episode 8 (landing page). Before filing these, each one
was traced against the actual code in this repo — not just restated from the symptom —
following the same standard as the Episode 6/7 gap-closure commit ("found by checking claims
against the [...] doc precisely rather than from memory"). Two of the four have a confirmed
root cause with a file/line pointer; two were traced end-to-end without finding a bug, and
need the *exact* plan XML from manual testing to go further — see each section.

I could not run `npm test`/`npm run test:e2e` from the environment I traced this in (a bridged
Linux shell against this Mac's `node_modules`, which has macOS-native optional-dependency
bindings — a `rolldown`/`@rolldown/binding-*` mismatch, unrelated to this repo's own code).
Whoever picks this up should confirm current pass/fail status locally before trusting my
"already covered by existing tests" claims below at face value, though I did read the actual
test files, not just their names.

---

## Gap 1 — Large plan graphs render illegibly small (confirmed root cause)

**File**: `src/graph/PlanGraph.tsx`

```ts
useEffect(() => {
  // Large plans must never render pre-zoomed to an unreadable scale —
  // fit on every shape change (initial load, expand/collapse), not just once.
  const frame = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 200 }))
  return () => cancelAnimationFrame(frame)
}, [nodes.length, fitView])
```

...combined with `minZoom={0.05}` on the `<ReactFlow>` element, and the graph living inside a
fixed-size box (`src/app/planReaderPage.css`: `.plan-reader-page__graph { height: 520px; }`,
inheriting `max-width: 960px` from `.plan-reader-page`).

`fitView` computes whatever zoom level — down to `minZoom` — is needed to fit *every* node
into the current viewport. For a 100+-node plan inside a 520x960 box, that's a very small
zoom, which is exactly "tiny nodes, have to zoom in a lot." The comment above this code states
the *right* goal ("never render pre-zoomed to an unreadable scale") but the mechanism achieves
the opposite for large plans specifically — it's the small-plan case that comment was written
for, and it doesn't hold at the other end of the size range Story 6.1 itself calls out
("Extremely large plans (500+ nodes)").

**Fix direction** (verify against the current React Flow API before committing to specifics):
cap how far `fitView` can zoom out, e.g. `fitView({ padding: 0.2, duration: 200, minZoom: 0.5 })`
— pick whatever floor keeps `PlanNodeCard` labels legible in practice. Once capped, a large
plan will naturally exceed the 520x960 viewport, and React Flow's own pan (drag) and zoom
(scroll/controls) already handle navigating a canvas bigger than its container — that's the
"let it spill over, let me scroll both ways myself" behavior from manual testing, for free.
Also revisit `minZoom={0.05}` on `<ReactFlow>` itself once fitView's floor is fixed — 5% is
almost certainly below anything legible, and is what let fitView shrink this far in the first
place. `.plan-reader-page__graph`'s `overflow: hidden` should be left alone — it's just React
Flow's viewport window onto the pannable canvas, not a content clip — but worth a quick
sanity check that nothing about it fights React Flow's internal pan once minZoom changes.

---

## Gap 2 — Full query text not visible in the details page (traced, not reproduced)

Traced the whole path; it looks correct end to end:
- `src/parsers/sqlserver/parseShowplanXml.ts` captures the complete `StatementText` attribute
  per statement (`stmtEl.getAttribute("StatementText")`) — no truncation.
- `src/app/analyzePlan.ts`'s `analyzePlanText` passes `stmt.statementText` through in full via
  `extra.statementText` into `buildPlanContext`. The `truncateLabel()` call in that same file
  only shortens the **tab label** shown when a batch has multiple statements — a different
  field — it never touches `statementText` itself.
- `src/graph/detailPanel/QueryCorrelation.tsx` renders the untouched `context.statementText`
  in a `<pre>` block.
- `src/graph/detailPanel/detailPanel.css`: `.detail-panel__query-text` has `white-space:
  pre-wrap` (wraps long lines, doesn't clip them) and no `max-height`/`overflow` of its own;
  the panel around it (`.detail-panel`) is `overflow-y: auto`, so a long query should make the
  whole panel scrollable, not cut it off.
- `src/parsers/sqlserver/__tests__/parseShowplanXml.test.ts` already asserts
  `stmt.statementText` on at least one fixture.

None of that explains what was seen. Two real possibilities remain:
1. The specific XML pasted during manual testing had `StatementText` **already truncated at
   the source** — a known real-world behavior for some plan-cache/Query Store capture paths
   (SQL Server itself can cap what it stores there). If so, the data simply isn't in the XML
   and no client-side parsing change can recover it — the fix is an honest UI message, not a
   parser fix.
2. A capture-method shape I don't have a fixture for yet. SSMS "Include Actual Execution
   Plan," a saved `.sqlplan` file, Extended Events capture, and Query Store each wrap things
   slightly differently — the fixture list in `parseShowplanXml.test.ts` covers default vs.
   prefixed namespaces and Extended-Events wrapping, but not every combination.

**Before writing any fix**: get the actual plan XML from manual testing, save it as a new
fixture under `src/parsers/sqlserver/__tests__/fixtures/` (existing naming pattern), and add
one assertion on the full statement text. If the fixture's own `StatementText` attribute is
already short, that confirms possibility 1 — message it honestly in the UI instead of chasing
a parser bug that isn't there.

---

## Gap 3 — SQL Server node details (actual rows, time, filtered rows, index name) not populating (traced, not reproduced — re-check all three engines)

`parseShowplanXml.ts`'s `readRunTimeInformation()` + `buildNode()` already extract exactly
these fields — `RunTimeInformation/RunTimeCountersPerThread/@ActualRows`, `@ActualElapsedms`,
`@ActualExecutions`; `rowsRemovedByFilter` via `ActualRowsRead` minus `ActualRows`; index name
via `Object/@Index` — and each is asserted in the existing suite (e.g. the "parses a simple
scan" and "aggregates per-thread parallel data" tests). `buildStatRows.ts` (the panel's data
source) already renders each field dynamically when present and an explicit "no actual run
data available for this node" gap row — never a blank one — when it's genuinely absent. That
part is Gap 4, and it's already built the way it should be; see below.

Most likely explanations, in order:
1. **The pasted plan was an *estimated* plan**, not an *actual* one (SSMS's "Display Estimated
   Execution Plan," or a `.sqlplan` saved before running). Real Showplan XML with no execution
   has no `RunTimeInformation` element at all — `actualRows`/`actualTimeMs`/
   `rowsRemovedByFilter` are then *correctly* absent, and the panel's gap-row message is
   correct behavior, not a bug. Worth explicitly ruling this out first — it's the cheapest
   check and the most common way to end up here by accident.
2. **A real XML-shape gap**: `findDirectChild(relOp, "RunTimeInformation")` requires it to be
   a *direct* child of `RelOp` — true for the fixtures tested, worth confirming against
   whatever produced the specific plan tested.
3. **Index name specifically**: `Object/@Index` is read via `findNearestDescendant(relOp,
   "Object")`. The one fixture covering a Key Lookup + Index Seek pair passes, but not every
   operator/Object nesting shape is covered.

**Before writing any fix**: same as Gap 2 — reproduce with the real pasted XML, add a fixture
and a failing test for the specific field(s) that didn't show, then fix. Also explicitly
**re-verify Postgres and Snowflake** the same way — the original testing note asked to check
all variants, not just SQL Server. `tests/postgres/` (209 real Postgres `EXPLAIN` outputs
across every node type, each with an `expected.json` naming exactly which fields that scenario
should surface) is built for this exact per-field regression check on the Postgres side.

---

## Gap 4 — Details page should render fields dynamically per variant

**Already implemented as designed.** `buildStatRows.ts` builds its row list conditionally per
field (`if (node.actualRows !== undefined) rows.push(...)`, and so on for every category —
cost, time, predicates, index, join, I/O, spill, pruning, parallel), with an explicit,
distinctly-styled `isGap` state (`.detail-panel__stat-gap`) for a field that's honestly
unavailable, never a blank row. This matches Story 6.2's stated intent exactly (see
`docs/10-node-stats-field-catalog.md` and the story's "never blank, broken, or silently
missing" acceptance criterion) — there's no fixed template with empty slots in this component.

Given that, "many things were empty" during manual testing is best explained by Gap 3, not by
this component: if the underlying `PlanNode` genuinely lacks a field — because the parser
didn't extract it, or the source plan is estimate-only — `buildStatRows` will *correctly* show
the honest gap state for it, which looks exactly like "this is empty and something's wrong"
to someone who doesn't know why. **No code change proposed here.** Closing Gap 3 (plus making
the estimate-vs-actual distinction more visually prominent than a small gray italic row, if
manual testing confirms an estimate-only plan was in play) is very likely sufficient — worth
re-assessing this gap only after Gap 3 is closed, not in parallel with it.

---

## Suggested order

1. **Gap 1** — confirmed root cause, no reproduction needed, ready to fix directly.
2. **Reproduce Gaps 2 and 3** with the actual SQL Server XML from manual testing (or a fresh
   capture) before writing any code for either — save it as a fixture regardless of which way
   it turns out, since both a real bug and a data-source limitation are worth a permanent
   regression test.
3. Re-verify the same fields (actual rows/time/index name/full query) against Postgres and
   Snowflake plans too, per the original testing note.
4. **Gap 4** — no code change on its own; re-assess after Gap 3 closes.
