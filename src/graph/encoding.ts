// Episode 6 — visual encoding. Pure, framework-agnostic scaling functions so
// the size scale and edge-width scale are each one function used everywhere
// they're needed (the legend-toggle requirement in the technical spec:
// re-run the same function against a different metric field rather than
// writing parallel rendering logic per encoding). See
// .claude/skills/graph-visualization/SKILL.md.
//
// Episode 26, Story 26.7 — this module used to export a matching `colorFor`
// (a per-node heatmap fill, cool blue -> warm red by metric value) alongside
// `sizeFor`, per the skill's original "size AND color both scale with the
// active metric" requirement. Removed: a mockup-driven restyle pass
// (docs/08-episodes-and-stories.md Story 26.7) replaced the whole-card
// heatmap fill with flat, neutral node cards — matching the reference
// mockup pixel-for-pixel — confirmed with the user as a deliberate,
// explicit supersession of that requirement, not an oversight. Severity/
// mismatch are still surfaced via border shape and badge text, never color
// alone, unchanged. Size-by-metric (`sizeFor` below) is untouched — this
// story only ever touched color.

import { collectNodes, type PlanNode } from "../parsers/normalize"

export const NODE_WIDTH_RANGE = { min: 150, max: 260 } as const
export const NODE_HEIGHT_RANGE = { min: 56, max: 96 } as const
export const EDGE_WIDTH_RANGE = { min: 1.5, max: 8 } as const

export type MetricKey = "actualTimeMs" | "estimatedCost" | "actualRows" | "estimatedRows"

/** "Actual time when available, estimated cost otherwise" per the technical
 * spec — falls further back to row counts so every node still gets a
 * meaningful size/color even on an estimate-only, row-less edge case. */
export function pickMetricValue(node: PlanNode, metric: MetricKey): number {
  const value =
    metric === "actualTimeMs"
      ? (node.actualTimeMs ?? node.estimatedCost ?? node.actualRows ?? node.estimatedRows)
      : metric === "estimatedCost"
        ? (node.estimatedCost ?? node.actualTimeMs ?? node.actualRows ?? node.estimatedRows)
        : metric === "actualRows"
          ? (node.actualRows ?? node.estimatedRows)
          : (node.estimatedRows ?? node.actualRows)

  // Floor at 0 — negative/NaN/undefined must never produce a degenerate or
  // invisible node (zero-cost Result nodes are legitimate input).
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}

export interface MetricScale {
  metric: MetricKey
  maxValue: number
  /** 0..1, already floored/clamped — never NaN. */
  normalize: (value: number) => number
  sizeFor: (value: number) => { width: number; height: number }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Built once per render from the whole tree (so every node's size/color is
 * relative to the same plan-wide max), then reused per node — this is the
 * "one scaling function, parameterized by metric" the legend toggle relies on. */
export function buildMetricScale(root: PlanNode, metric: MetricKey): MetricScale {
  const values = collectNodes(root).map((node) => pickMetricValue(node, metric))
  const maxValue = Math.max(0, ...values)

  const normalize = (value: number): number => {
    if (maxValue <= 0) return 0 // every node is zero/absent for this metric — flat scale, not a crash
    // sqrt compresses the range so one huge outlier doesn't shrink every
    // other node to an indistinguishable minimum (area-proportional sizing
    // is the standard convention for this kind of size encoding).
    return clamp01(Math.sqrt(value / maxValue))
  }

  const sizeFor = (value: number) => {
    const t = normalize(value)
    return {
      width: Math.round(NODE_WIDTH_RANGE.min + t * (NODE_WIDTH_RANGE.max - NODE_WIDTH_RANGE.min)),
      height: Math.round(NODE_HEIGHT_RANGE.min + t * (NODE_HEIGHT_RANGE.max - NODE_HEIGHT_RANGE.min)),
    }
  }

  return { metric, maxValue, normalize, sizeFor }
}

export interface EdgeWidthScale {
  maxRows: number
  widthFor: (rows: number) => number
}

/** Edge thickness scales with row count flowing between operators — the
 * child's row count (what it produced, flowing up into its parent). */
export function buildEdgeWidthScale(root: PlanNode): EdgeWidthScale {
  const rows = collectNodes(root).map((node) => Math.max(0, node.actualRows ?? node.estimatedRows ?? 0))
  const maxRows = Math.max(0, ...rows)

  const widthFor = (value: number): number => {
    if (maxRows <= 0 || !Number.isFinite(value) || value <= 0) return EDGE_WIDTH_RANGE.min
    const t = clamp01(Math.sqrt(value / maxRows))
    return Number((EDGE_WIDTH_RANGE.min + t * (EDGE_WIDTH_RANGE.max - EDGE_WIDTH_RANGE.min)).toFixed(2))
  }

  return { maxRows, widthFor }
}
