# Skill: Graph Visualization & Interactive UI

**Use this skill whenever writing, reviewing, or debugging code in `src/graph/`** — React Flow + dagre rendering of the `PlanNode` tree and all interactive UI built on top of it.

## Source of truth

Full requirements: `docs/technical-spec.md` §3 and §3.1, `docs/prd.md` §6a (Interactive UI requirements), `docs/episodes.md` Episode 6.

## Stack

- **React Flow** (`@xyflow/react`) for the interactive graph surface.
- **dagre** (`@dagrejs/dagre`) for tree layout, per the team's own recommendation for tree-shaped graphs. If layout looks cramped on large/deep real-world plans during testing, **elkjs** is the documented fallback — don't reach for it preemptively, dagre first.

## Visual encoding (must match exactly — these are product decisions, not styling preferences)

- Node size and color both scale with the active metric (cost, actual time, or rows — see legend toggle below), heatmap cool→warm.
- Edge thickness scales with row count flowing between operators.
- Estimate-vs-actual mismatch is shown via a **distinct border/badge, never color alone** — this must stay colorblind-accessible. Verify with a colorblindness simulator as part of any change touching this encoding.
- Loop count shown as a small multiplier badge on nodes with `loops > 1`.

## Interactive components — implementation notes

- **Expand/collapse**: state lives in local component state keyed by node ID, **not** in the `PlanNode` model itself — the data model stays pure/serializable. Default collapse threshold (e.g. subtrees below X% of total plan cost) is a tunable constant.
- **Pan/zoom/fit-to-view**: use React Flow's native pan/zoom and `fitView()` API. Call `fitView()` on initial load — large plans must never render pre-zoomed to an unreadable scale.
- **Hover tooltip vs. click detail panel are two separate components.** Tooltip: lightweight, a handful of key stats, fast to render. Detail panel: full normalized fields + raw `attributes` bag + `Warning[]` for that node. Don't build one component that "just gets bigger" on click — keeps the hover path cheap.
- **Search/filter**: derive from existing node/edge state (match against `operatorType`, `rawOperatorLabel`, table/relation name, warning severity). Matching nodes highlight; **non-matching nodes dim (reduced opacity), never disappear from the DOM** — losing tree shape/context mid-search is a real usability regression, not a minor detail.
- **Encoding legend toggle**: re-runs the *same* size/color scaling function against a different metric field. Do not write parallel rendering logic per encoding — one scaling function, parameterized by which field it reads.
- **Guided walkthrough mode**: a linear ordering of nodes (inside-out execution order — deepest/leftmost first, matching standard plan-reading convention) drives next/previous narration. **Reuses `Warning.shortText`/`longText` from the rule engine** (see `rule-engine-authoring` skill) — this must never become a second content-authoring surface with its own copy.
- **Beginner/Expert toggle**: a display-mode flag selecting `Warning.shortText` vs. `Warning.longText`. Both strings already exist on the `Warning` object at rule-authoring time — this toggle does not compute or generate text at runtime.
- **Node-to-query-text correlation**: only activates when original query text is available (pasted alongside the plan, or embedded in the plan format itself, e.g. Postgres's `Query Text` field or SQL Server's `StatementText`). Treat as additive — absence of query text must not degrade any other part of the UI. Every existing tool that's attempted this calls its own implementation "rudimentary" — aim to actually solve it well, since it's a real, consistently-under-delivered differentiator.
- **Keyboard navigation**: arrow keys move a "current node" pointer through the tree; `Enter`/`Space` opens the detail panel; `/` focuses search; `Escape` closes overlays. Build and test this as its own concern — it will not fall out of mouse-oriented component design for free.
- **Cross-instance synced selection** (Episode 14's `PlanComparisonView`, two `PlanGraph`s driving each other's selection): `PlanGraph`'s `onNodeSelected` callback must fire ONLY for a selection that originates in that instance (a click/keyboard activation), never for one arriving via its own `focusNodeId` prop. `focusNodeId`/`onFocusHandled` (Story 13.1) is a "the caller told me to focus this, and I clear it once handled" channel; if the focus-handling effect also calls `onNodeSelected`, a second synced instance receiving that as ITS `focusNodeId` will echo back out the same way, and the two instances ping-pong forever (a real infinite-render loop hit during Story 14.2 — see `PlanGraph.tsx`'s `focusNodeId` effect for the fix and full explanation). The one-directional rule: clicks flow out via `onNodeSelected`; focus requests flow in via `focusNodeId` and never loop back out.
- **Image export**: render current view to canvas/SVG, trigger a browser download. No server round-trip — this must stay inside the fully-client-side privacy architecture (see `privacy-architecture` skill).
- **Theme toggle**: use CSS custom properties / design tokens from the start, not a late retrofit.

## Performance

- Virtualize/collapse by default beyond a node-count threshold (500+ nodes is the documented risk point for browser freeze).
- Benchmark render time and pan/zoom responsiveness at 10, 100, and 500+ node plan sizes as part of any change to the rendering pipeline.
- Test dagre layout specifically at mobile viewport widths, not just desktop — the product must be usable from a phone per the positioning brief's mobile-usability requirement.

## Testing checklist for any change in this directory

- [ ] Visual regression/snapshot test across the fixture library (small/simple through large/complex).
- [ ] Colorblindness-simulator check for any change touching mismatch/severity encoding.
- [ ] Zero-cost/zero-row node fixture confirms no division-by-zero or degenerate node sizing.
- [ ] Shared-reference fixture (CTE / multi-parent operator) confirms the graph renders a linking indicator rather than a duplicated subtree.
- [ ] Mobile-width test for any change to layout or interaction.
