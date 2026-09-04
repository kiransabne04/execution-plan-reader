// Episode 18, Story 18.11 — PNG export. Deliberately reuses drawGraph
// (canvasDraw.ts) — the same drawing functions CanvasPlanGraph.tsx's live
// on-screen rendering already calls — rather than a second, independent
// export-only drawing path or a DOM-screenshot approach: per the canvas-
// rendering-performance skill's "layout and rendering stay separate, never
// fork" rule, this is the ONE place node/edge pixels get drawn, whether
// that's onto a live, interactive canvas or an offscreen export one. This
// is also why export looks identical regardless of whether the live view
// happens to be in DOM/SVG or canvas mode right now (spec §5 `1j`) — both
// modes' "Export" button calls this same function against the same
// buildGraphElements() output, with no reference anywhere to which mode
// produced it.
//
// Always renders at `transform.scale` up to 1 (never the DOM/SVG path's
// MIN_LEGIBLE_ZOOM floor, and never canvas mode's own LEGIBLE_ZOOM_FLOOR
// degrade in canvasDraw.ts) — an export is meant to be looked at closely
// later, at whatever size the viewer opens it, so it should always carry
// full label/icon/subtitle detail, never the live view's current zoom
// level or its heat-block degrade.

import type { PlanGraphEdge, PlanGraphNode } from "../buildGraphElements"
import { drawGraph, type DrawGraphParams } from "./canvasDraw"
import { computeBounds } from "./graphBounds"
import type { ViewportTransform } from "./viewportTransform"

/** Kept comfortably under common browser canvas size/area limits (Chrome
 * and Firefox both cap a single canvas dimension around 16,384px, with a
 * lower practical area limit) — this is the edge case a 1000+-node plan's
 * "stays within reasonable bounded time" requirement actually maps to:
 * bounding the canvas SIZE directly bounds `toBlob`'s own work. */
const MAX_EXPORT_DIMENSION_PX = 8000
const EXPORT_PADDING_PX = 40

export interface ExportLayout {
  transform: ViewportTransform
  width: number
  height: number
}

/**
 * The pure layout math (bounds -> transform + canvas size), independently
 * unit-testable without a real canvas context (jsdom has none — see
 * canvasDraw.test.ts's own fake-context comment for why the drawing itself
 * isn't unit-tested the same way). `null` for an empty node set (never
 * expected for a real analyzed plan, but an honest result rather than a
 * thrown error or a degenerate 0x0 canvas).
 */
export function computeExportLayout(nodes: PlanGraphNode[]): ExportLayout | null {
  const bounds = computeBounds(nodes)
  if (!bounds) return null

  const rawWidth = bounds.maxX - bounds.minX
  const rawHeight = bounds.maxY - bounds.minY
  // 1:1 (world unit = device pixel) whenever that fits the size cap;
  // downscaled proportionally only when it wouldn't — never upscaled
  // (a scale above 1 would just blur already-crisp text for no benefit).
  const scale = Math.min(1, MAX_EXPORT_DIMENSION_PX / Math.max(rawWidth, rawHeight, 1))

  return {
    transform: {
      x: EXPORT_PADDING_PX - bounds.minX * scale,
      y: EXPORT_PADDING_PX - bounds.minY * scale,
      scale,
    },
    width: Math.round(rawWidth * scale + EXPORT_PADDING_PX * 2),
    height: Math.round(rawHeight * scale + EXPORT_PADDING_PX * 2),
  }
}

export interface ExportPngColors {
  textColor: string
  selectionColor: string
  /** Story 18.11's own addition to DrawGraphParams — see that type's doc
   * comment for why export needs an opaque fill the live canvas doesn't. */
  backgroundColor: string
  comparisonColors?: DrawGraphParams["comparisonColors"]
  edgeColors: DrawGraphParams["edgeColors"]
  severityColors: DrawGraphParams["severityColors"]
}

/**
 * Renders the current graph (whatever `nodes`/`edges` the caller already
 * computed via `buildGraphElements` — including its current
 * `collapsedIds`, so a collapsed subtree exports collapsed, matching
 * what's actually on screen, never a forced full-expand) to a PNG `Blob`,
 * entirely client-side (a `<canvas>` element created here never gets
 * attached to the document, and `toBlob` never touches the network) — no
 * privacy-architecture review needed, this produces a local file, nothing
 * leaves the browser. `null` when there's nothing to export or the browser
 * couldn't produce a 2D context (mirrors CanvasPlanGraph.tsx's own
 * null-context guard) or couldn't encode a blob.
 */
export function exportGraphToPngBlob(nodes: PlanGraphNode[], edges: PlanGraphEdge[], colors: ExportPngColors): Promise<Blob | null> {
  const layout = computeExportLayout(nodes)
  if (!layout) return Promise.resolve(null)

  const canvas = document.createElement("canvas")
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)

  drawGraph(ctx, {
    nodes,
    edges,
    transform: layout.transform,
    cssWidth: layout.width,
    cssHeight: layout.height,
    textColor: colors.textColor,
    selectionColor: colors.selectionColor,
    backgroundColor: colors.backgroundColor,
    comparisonColors: colors.comparisonColors,
    edgeColors: colors.edgeColors,
    severityColors: colors.severityColors,
  })

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
}
