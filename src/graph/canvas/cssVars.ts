// Episode 15, Story 15.1 originally (inside CanvasPlanGraph.tsx); moved
// here in Episode 18, Story 18.11 once PNG export (exportPng.ts) needed
// the exact same "read a CSS custom property off a live DOM element"
// resolution CanvasPlanGraph already did for its own theme-consistent
// colors — one implementation, not a second one re-derived for export.

/** Reads a CSS custom property already defined on the ancestor `.plan-
 * graph` element (planGraph.css) rather than hardcoding a color here — the
 * canvas path (and PNG export) stay theme-consistent with the DOM/SVG
 * path's own tokens. */
export function resolveCssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}
