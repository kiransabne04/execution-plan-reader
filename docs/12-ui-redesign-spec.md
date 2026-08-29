# 12 — UI redesign spec

Status: confirmed. Implementation spec for the PlanReader UI redesign. Mockups: `PlanReader UI Mockups.dc.html` (screen ids `2a`–`2c`, `1d`–`1k`).

This is a restyle plus five new surfaces. No parser, analyzer, or rule changes. Dark-only.

---

## 1. Design tokens

Replace the per-component `--pr-*`, `--pg-*`, `--dp-*`, `--fl-*` blocks with one palette. Delete every `prefers-color-scheme` branch — this is a dark-only product.

| Role | Value |
| --- | --- |
| Page ground | `#161826` |
| Canvas ground | `#12131d` |
| Rail ground | `#13141f` |
| Surface / node card | `#232532` |
| Border | `rgba(233,233,237,.12)`; strong `#3f424d` |
| Text | primary `#e9e9ed`, secondary `#9397ab`, muted `#75798c`, on-tint `#cfd3e5` |
| Accent | `#9184d9`; hover `#b5abfc`; on-tint text `#d2cefd` |
| Critical | `#f97066` |
| Warning | `#f79009`; text `#fdb022` |
| Funnel callout | `#2dd4bf` — stays teal, deliberately unlike a warning |
| Radius | 4 / 8 / 14px |
| Type | Inter 400/500/600; mono (`ui-monospace, Menlo, monospace`) for identifiers and plan text |
| Icons | Phosphor regular; fill weight only for the brand mark |

Tinted fills are `color-mix(in srgb, <hue> 14–24%, #232532)`, never flat saturated fills. Severity chips are the severity colour at 18% over the surface with a 40–50% border.

Focus: `:focus-visible { outline: 2px solid #9184d9; outline-offset: 2px }` on every interactive element. No default browser ring anywhere.

---

## 2. App shell (`2a`)

Three columns inside a `container-type: inline-size` shell — everything measures against the shell's own width, not the viewport, so it behaves the same embedded or full-page.

```css
grid-template-columns: clamp(232px,20cqi,296px) minmax(360px,1fr) clamp(300px,26cqi,384px);
```

- The rails are the flexible tracks and shrink first. The canvas holds a hard **360px floor** — grid would otherwise drain the `1fr` track while the rails sat at their max, starving the primary content.
- Shell height is `100dvh` with `min-height: 0` on every scroll container: only the rails and the panel scroll, never the page.
- Summary type `clamp(12.5px, 1.05cqi, 14px)` at a `68ch` measure. App-bar gaps `clamp(8px, 1cqi, 14px)`.
- App bar (52px): brand → filename (truncates, `min-width:0`) → engine badge → spacer → Beginner/Expert segmented control → "Walk me through it" → share icon → export icon. Share and Export drop to icon-only before anything wraps.
- Left rail: Plan input (dropzone, collapsed source preview, Analyze, privacy statement) over Findings (count, two filter selects, severity cards). Filters are `grid-template-columns: repeat(auto-fit, minmax(96px,1fr))` so they stack in one step.
- Centre: one-sentence plain-language summary + metrics strip (total, node count, collapsed count, colour legend, "Width = rows · Arrows = execution order"), then the graph.
- Right rail: node detail panel, un-fixed — it is a grid track, not a fixed overlay, above 1180.

### Breakpoints (`2b`)

Four steps, each changing structure rather than sizes. Between them everything is fluid.

| Width | Change |
| --- | --- |
| 1180 | Detail panel leaves the grid, becomes an overlay with a scrim. Canvas keeps its full width. |
| 860 | Input rail collapses to a one-line disclosure bar. Graph and findings become tabs. |
| 620 | Mobile layout (`1k`). Detail becomes a bottom sheet. |

Content stack follows the panel: in-panel above 860, footer band below.

---

## 3. Node encoding — one card, seven signals

| Signal | Source | Treatment |
| --- | --- | --- |
| Fill | `colorFor()` | Hue 210°→0° mixed 14–24% into `#232532` |
| Width | `sizeFor()` | 150→300px on row count, sqrt-compressed |
| Edge thickness | `buildEdgeWidthScale()` | 1.5→8px on rows into the parent |
| Severity ring | `Warning.severity` | 2px amber / 3px red box-shadow + faint glow. Never colour alone |
| Dashed border | est/actual mismatch | As built |
| Badges | loop count `×N`, spill size, mismatch factor | Pill, severity-tinted |
| Subtitle | `relationName` / `index.name` | Mono, ellipsised |

Layout direction changes to dagre `rankdir: "BT"` — leaves at the bottom, arrows pointing the way execution flows. Handles swap: source Top, target Bottom.

### Operator icons

New map beside `operatorMap.ts`, keyed on `operatorType`, fallback `ph-circle` for `unknown`:

| Operator | Icon |
| --- | --- |
| Limit | `ph-arrow-line-down` |
| Aggregate / GroupAggregate | `ph-function` |
| Sort | `ph-sort-ascending` |
| Join (hash, merge, nested loop) | `ph-arrows-merge` |
| Seq / table scan | `ph-rows` |
| Hash | `ph-hash` |
| Index scan / seek | `ph-magnifying-glass` |

---

## 4. Edge rendering

This was wrong in the first mockup pass; the rules below are the correction.

- **Orthogonal routing, 8px rounded elbows** — vertical out of the child, one horizontal run, vertical into the parent. React Flow `type: "smoothstep"`, `borderRadius: 8`. No bezier curves; they cross node boxes on wide fan-ins.
- **Multiple inputs enter the parent's bottom edge at separate x offsets**, not one shared point. One target handle per input index.
- **Arrowheads are a fixed 11px** regardless of stroke weight: `markerUnits="userSpaceOnUse"`, marker fill matching the edge stroke. Default `strokeWidth` scaling makes a 7px hot edge sprout a ~40px head.
- Edges stop **10px short** of the parent border so the head reads as an arrival, not an overlap.
- Two stroke colours only: `#8d6a6a` on the hot path, `#6b6f82` elsewhere. Thickness carries row volume, colour carries hot-path membership.

---

## 5. Screens

### `1d` Landing / empty state
- Copy verbatim from `positioningCopy.ts` and `privacy/copy.ts` — headline, subheadline, engine list, placeholder, privacy statement, extensions caveat. Story 8.1 asserts an exact match; do not rewrite.
- Hero + engine badges paint above the fold with no loading gate (Story 8.1).
- **New**: dropzone + file picker. `FileReader.readAsText`, hand the string to the existing `analyzePlanText()` — no new parse path, no upload. `privacy/networkGuard.ts` tests still apply.
- **New**: sample buttons loading from `src/fixtures/`, one per engine, each chosen to fire a different rule.
- Analyze stays disabled while the textarea is empty.

### `1e` Parsing, error and edge states
- All error copy comes from `PlanParseError` messages; the UI renders `err.message` directly and adds only the severity treatment. Never echo pasted content.
- Three severities, three treatments: red left-rule = can't proceed; amber = partial result available; blurple = informational.
- Estimate-only and parameter-sensitivity notes are PRD §3 commitments and must be visible in the result, not only in docs.
- The parsing indicator is new. Parsing is synchronous today — if it stays synchronous, drop the card rather than fake it.

### `1f` Node detail panel — Beginner / Expert
- Section order fixed, matching `DetailPanel.tsx`. Education (blurple tint) and findings (severity left-rule) stay visually distinct — Story 6.2 acceptance criterion.
- **Beginner**: long definition plus when-it's-fine / when-to-look-closer from `glossary/entries.ts`; prose warning text; curated stat rows; query correlation visible; raw attributes hidden.
- **Expert**: education collapsed to one line; rule id shown; full `buildStatRows()` output including gaps; raw attributes expanded.
- Gap rows keep the italic muted treatment — an honest "not available", never a fabricated zero.
- Cumulated and per-execution timings are always labelled as different things.
- Escape closes and returns focus to the triggering node card. Not a focus trap.
- Mode is page state, rendered as the app-bar segmented control, shared with the walkthrough.

### `1g` Guided walkthrough (new)
- New component directory `graph/walkthrough/`. Full-screen focus mode, one node at a time, graph dimmed behind.
- Step order = post-order traversal of the PlanNode tree (leaves first = execution order), filtered to nodes carrying a warning or ≥10% contribution, root always included.
- Narration generated from the same `glossary` + `Warning.shortText` data the panel uses — no second content source.
- Beginner mode by default; entering from Expert keeps the toggle but shortens narration.
- Keyboard: ← → step, Esc exits, focus lands on the step heading each advance.
- Exit returns to the shell with the last-viewed node selected in the detail panel.

### `1h` Search & filter (new)
- Opens on `/` or `⌘K`. Searches `rawOperatorLabel`, `relationName`, `index.name` and warning severity over `collectNodes(root)`.
- Non-matching nodes drop to 32% opacity rather than unmounting, so the plan's shape stays readable.
- Selecting a result reuses the existing `focusNodeId` path in `PlanGraph` — it already expands collapsed ancestors.
- Filter chips are additive and mirror the two selects in `FindingsList.tsx`. One source of truth for filter state.

### `1i` Large plans — canvas mode & accessible list
- Threshold is `CANVAS_NODE_COUNT_THRESHOLD = 300` in `PlanGraph.tsx`. The banner explains the switch instead of leaving the user to notice a different-feeling canvas.
- Labels drawn by `canvasDraw.ts`; below the legible-zoom floor nodes degrade to solid heat blocks with no text.
- Selection is a drawn 2px accent outline — there is no DOM focus ring to inherit.
- The list toggle is always visible in the toolbar; `AccessiblePlanList.tsx` mounts only when opened. Indentation = depth; the collapsed-group row carries the same hidden-count text as the graph's placeholder node.

### `1j` Batch tabs, share link, PNG export
- Tabs already exist in `PlanReaderPage.tsx` (`role="tablist"`, shown when `statements.length > 1`). Additions: duration and severity dot per tab.
- Share link is `shareLink.ts`; the long-link warning is the existing `share-link__message--warning` state with real copy.
- **New**: PNG export. Render the `canvasDraw.ts` path offscreen at export size and `toBlob()` — both graph modes export identically and nothing leaves the browser.

### `1k` Mobile
- Below 900px the three columns become: input screen → result screen with Findings/Graph tabs → detail as a bottom sheet.
- Findings lead, not the graph. A phone can't show a useful node graph, and the e2e mobile specs assert the hero and summary are reachable without scrolling.
- All touch targets ≥44px. The sheet replaces the fixed side panel below 480px (partly handled in `detailPanel.css`).
- Paste is the primary input; the file picker is a second button — drag-and-drop is meaningless on touch.

### `2c` Content stack
- New `app/content/ContentStack.tsx` plus `app/content/posts.ts`: `{id, kind:"blog"|"video", title, url, minutes, operatorTypes[], ruleIds[]}`.
- In-panel placement matches on the open node's `operatorType` or a fired `Warning.ruleId`; render nothing when there's no match.
- Kept visually apart from the pgsuite/QueryDoc callout — that one is teal and a product nudge, this is neutral and editorial. Never stack the two adjacent.
- Titles in the mockup are placeholders. Do not ship invented links; render the stack only once `posts.ts` has real entries.
- External links open in a new tab with `rel="noopener"`. No analytics beacon on click — that would breach the no-network guarantee.

---

## 6. Build order

1. Token palette only — one dark palette, `prefers-color-scheme` branches deleted. No layout change.
2. App shell layout (`2a`) — three-column grid, detail panel un-fixed.
3. Beginner/Expert lifted to page state, rendered in the app bar.
4. Node encoding + operator icon map + bottom-up dagre direction + edge rendering (§3, §4).
5. File drop, file picker, sample loaders (`1d`).
6. Error and edge-state treatments (`1e`).
7. Detail panel densities (`1f`).
8. Search palette (`1h`) on the existing `focusNodeId` plumbing.
9. Guided walkthrough (`1g`) — the longest single item.
10. PNG export (`1j`), then mobile breakpoints (`1k`).

Steps 1–4 are the low-risk restyle block. Restyle-only, no behaviour change: PasteBox, privacy copy, error rendering, statement tabs, share link, findings list, detail-panel sections, canvas threshold, accessible list.

---

## 7. Constraints that must survive

- Privacy statement sits at the input, not in a footer — and the extensions caveat stays with it.
- No network call on the rule-based path. File upload is `FileReader`, never a POST.
- Hero copy matches `positioningCopy.ts` character for character, above the fold, no loading gate.
- Error text never echoes pasted content.
- Missing data renders as an explicit gap row, never a zero.
- Cumulated and per-execution timings are always labelled as different things.
- Education and findings stay visually distinct.
- Funnel callouts are dismissible, engine-matched, and never shown without a fired warning.
- Every node reachable and openable by keyboard; Escape closes the panel and returns focus.

---

## 8. Parked — plan comparison (episode 2)

Not designed. Captured so this redesign leaves room for it:

- A **Compare** action appears in the app bar once a plan is visualised — before/after being the common case.
- It opens an input for the second plan (paste or file), same privacy statement, same parse errors.
- The comparison itself is a full-screen modal, not a route change — the first plan stays behind it.
- Content: per-node diff (improved / regressed / unchanged / added / removed), total time and row deltas, and which findings the second plan resolves or introduces.

Touch points in this redesign: the app-bar action row and the shell's overlay layer. Nothing above blocks it.
