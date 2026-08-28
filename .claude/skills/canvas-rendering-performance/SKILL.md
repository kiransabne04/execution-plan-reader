# Skill: Canvas Rendering & Performance

**Use this skill whenever writing, reviewing, or debugging the canvas-based rendering path in `src/graph/canvas/`** — the large-plan rendering mode that takes over from React Flow's DOM/SVG rendering above the node-count threshold. Read `graph-visualization/SKILL.md` first for the shared concepts (visual encoding scheme, node data model) — this skill covers what's specific to the canvas path.

## Source of truth

Full requirements: `docs/04-technical-spec-v1.md` §3 (revision note), `docs/08-episodes-and-stories.md` Episode 15.

## Why this path exists

React Flow renders one DOM element per node. DOM/SVG-based rendering is genuinely fine, even preferable, at normal plan sizes — it's what gives Episode 6's interactivity (hover, click, keyboard nav, accessibility) for free. But it degrades as node count grows, because every node is a tracked, styleable, event-handling DOM object the browser has to manage. Canvas draws directly to a pixel surface — the browser doesn't retain per-shape objects, so performance stays close to constant regardless of node count. The trade-off is real and unavoidable: canvas has no built-in interactivity or accessibility. Both have to be rebuilt by hand. This skill exists to make sure that rebuild is done correctly, not skipped.

## Non-negotiable rules

1. **Layout and rendering stay separate.** dagre computes node positions/sizes and edge routes exactly as it does for the DOM/SVG path (`graph-visualization` skill) — the canvas path consumes the same layout output, it just draws it differently. Never duplicate or fork the layout logic for canvas mode.
2. **Hit-testing must be built explicitly — there is no free equivalent to DOM click events.** Store each node's bounding box (from dagre's layout) in a lookup structure; on click/hover, map the pointer coordinate (adjusted for current pan/zoom transform) against stored bounding boxes to determine which node, if any, was targeted. For realistic plan sizes here (up to low thousands of nodes), a linear scan is acceptable — don't over-engineer a spatial index (quadtree, etc.) unless benchmarking actually shows it's needed.
3. **Redraw only on change, never continuously.** Use a dirty-flag pattern: redraw is triggered by an actual state change (pan, zoom, node selection, data update), batched through `requestAnimationFrame`, not fired per raw input event or on a timer/interval.
4. **Scale for `devicePixelRatio`, always.** A canvas rendered at CSS pixel resolution looks blurry on high-DPI/retina displays. Set the canvas's backing store size to `cssWidth * devicePixelRatio` / `cssHeight * devicePixelRatio`, then scale the drawing context by the same factor. This is easy to forget and immediately visible when missed.
5. **Pause the render loop when the tab isn't visible.** Check `document.visibilityState` — no reason to burn CPU redrawing a tab the user isn't looking at.
6. **The threshold between DOM/SVG and canvas mode is a tunable constant, chosen from real benchmark data, not guessed.** See the testing checklist below.

## Accessibility is required, not optional (Story 15.2)

Canvas content is invisible to assistive technology by default — it's a bitmap, not enumerable DOM nodes. Any PR that adds or changes canvas rendering and does not also address the accessible fallback should be treated as incomplete, not deferred:

- An equivalent accessible list/table view of the same plan must be available and clearly reachable whenever canvas mode is active — not a buried link.
- Keyboard navigation (arrow keys, search, detail panel open) must work identically via the accessible list view when canvas is active.
- The `<canvas>` element itself needs appropriate ARIA treatment (a descriptive `role="img"` label, or `aria-hidden` if the accessible list is the true interactive surface) so screen readers don't attempt to read raw pixel data.
- State (selected node, active filter, collapsed subtrees) is shared between the canvas view and the accessible list view — they're two presentations of one state, not two independently-drifting views.

## Testing checklist for any change in this directory

- [ ] Performance benchmark at 50/100/250/500/1000+ node plan sizes — both render time and interaction latency (pan/zoom/click), for both DOM/SVG and canvas paths, to validate (or correct) the mode-switch threshold.
- [ ] Hit-testing unit tests: given known bounding boxes and a click coordinate, correct node (or none) is identified, including at non-default pan/zoom transforms.
- [ ] `devicePixelRatio` test: canvas content renders crisply on a simulated high-DPI display, not just at 1x.
- [ ] Visibility-change test: render loop pauses when `document.visibilityState` is `hidden`.
- [ ] Screen reader test (VoiceOver/NVDA at minimum) confirming the accessible list view is discoverable and fully navigable whenever canvas mode is active.
- [ ] Automated accessibility audit (e.g. axe-core) run specifically against canvas-mode UI — do not assume a pass on DOM/SVG mode implies a pass here, these are different code paths.
- [ ] Visual consistency check: canvas-rendered output uses the same node size/color/edge-thickness encoding conventions as the DOM/SVG path (`graph-visualization` skill) — a user switching between plan sizes shouldn't perceive the visualization as a different tool.
