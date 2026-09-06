// Episode 15, Story 15.2 — the accessible fallback required alongside the
// canvas rendering path (CanvasPlanGraph.tsx), not a follow-up. Canvas
// content is invisible to assistive technology by default; this is a plain
// semantic list of the same plan, sharing the SAME selection/collapse
// state as the canvas view (not a second, independently-drifting view —
// see .claude/skills/canvas-rendering-performance/SKILL.md's accessibility
// section). A native <ul> of <button>s gives Tab-order navigation and
// Enter/Space activation for free — the same keyboard access DOM/SVG mode
// (PlanNodeCard.tsx) actually provides today; this list intentionally
// doesn't claim a richer arrow-key/search scheme neither mode has built yet.

import type { PlanNode } from "../../parsers/normalize"
import { computeMismatchFactor } from "../../rules/badRowEstimate"
import { countDescendants, formatHiddenNodeCountText, buildSubtitle, spillBadgeTextFor, type ComparisonOverlay } from "../buildGraphElements"
import { SEVERITY_LABEL, worstSeverity } from "../nodeSeverity"
import { OPERATOR_ICON_COMPONENT, operatorIconKey } from "../operatorIcons"
import "./accessiblePlanList.css"

export interface AccessiblePlanListProps {
  root: PlanNode
  collapsedIds: Set<string>
  selectedNodeId?: string
  onSelectNode: (nodeId: string) => void
  onExpandCollapsedGroup: (parentPlanNodeId: string) => void
  /** Episode 14, Story 14.2 — same overlay map PlanNodeCard/canvasDraw
   * render, keyed by this tree's own PlanNode id. Canvas-rendering-
   * performance skill: state (here, comparison status) is shared between
   * the canvas view and this accessible list, not two independently-
   * drifting presentations. */
  comparisonOverlays?: Map<string, ComparisonOverlay>
}

const COMPARISON_LABEL: Record<Exclude<ComparisonOverlay["status"], "matched">, string> = {
  changed: "Changed",
  addedInB: "Added",
  removedFromB: "Removed",
}

type ListRow =
  | { kind: "node"; node: PlanNode; depth: number; isSharedReference: boolean }
  | { kind: "collapsed"; parentPlanNodeId: string; depth: number; hiddenCount: number }


function formatMeta(node: PlanNode): string {
  const rows = node.actualRows ?? node.estimatedRows
  const time = node.actualTimeMs
  const parts: string[] = []
  if (rows !== undefined) parts.push(`${rows.toLocaleString("en-US")} rows`)
  if (time !== undefined) parts.push(`${time.toFixed(1)}ms`)
  return parts.join(" · ")
}

/** Design review (downloaded "large execution plan node" PNG) — the same
 * specific-over-generic badge text PlanNodeCard/canvasDraw already show
 * (est. mismatch factor, spill size, loop count), not a second,
 * independently-computed set: reuses each rule's own real
 * computeMismatchFactor/spillBadgeTextFor rather than re-deriving them.
 * Mismatch, then spill, then loop count — priority only matters on the
 * rare node with more than one applicable badge; the mockup's own three
 * examples each had exactly one. Falls back to the plain severity word
 * (`SEVERITY_LABEL`) only when none of the three specific badges apply —
 * matching the mockup's own Seq Scan row, which shows a bare "warning"
 * pill precisely because it had nothing more specific to say. */
function badgeTextFor(node: PlanNode): string | undefined {
  const mismatch = computeMismatchFactor(node.estimatedRows, node.actualRows)
  // Same "est. mismatch" wording as canvasDraw.ts's own MISMATCH_BADGE_TEXT
  // constant, factor suffix omitted for the same near-infinite-ratio case
  // that has no clean number to show (this rule's own `factor: undefined`).
  if (mismatch?.isBad) return mismatch.factor !== undefined ? `est. mismatch ${mismatch.factor}×` : "est. mismatch"
  const spill = spillBadgeTextFor(node)
  if (spill) return spill
  if (node.loops !== undefined && node.loops > 1) return `×${node.loops.toLocaleString("en-US")}`
  return undefined
}

/** Same traversal shape as buildGraphElements.ts (a shared-reference node
 * — reachable from more than one parent — is placed once; every later
 * occurrence renders as a distinct linking row rather than a duplicated
 * subtree) and the same collapse semantics PlanGraph already tracks. Two
 * different data structures (React Flow elements vs. this flat row list)
 * deliberately built from the SAME PlanNode tree and the SAME collapsedIds
 * — not two views that could silently disagree with each other. */
function buildRows(root: PlanNode, collapsedIds: Set<string>): ListRow[] {
  const rows: ListRow[] = []
  const placed = new Set<string>()

  const walk = (node: PlanNode, depth: number) => {
    const alreadyPlaced = placed.has(node.id)
    rows.push({ kind: "node", node, depth, isSharedReference: alreadyPlaced })
    if (alreadyPlaced) return
    placed.add(node.id)

    if (collapsedIds.has(node.id) && node.children.length > 0) {
      rows.push({ kind: "collapsed", parentPlanNodeId: node.id, depth: depth + 1, hiddenCount: countDescendants(node) })
      return
    }
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  return rows
}

export function AccessiblePlanList({
  root,
  collapsedIds,
  selectedNodeId,
  onSelectNode,
  onExpandCollapsedGroup,
  comparisonOverlays,
}: AccessiblePlanListProps) {
  const rows = buildRows(root, collapsedIds)

  return (
    <ul className="accessible-plan-list" data-testid="accessible-plan-list" aria-label="Plan nodes, as a list">
      {rows.map((row) => {
        if (row.kind === "collapsed") {
          return (
            <li key={`collapsed-${row.parentPlanNodeId}`} style={{ paddingLeft: row.depth * 16 }}>
              <button
                type="button"
                className="accessible-plan-list__item accessible-plan-list__item--collapsed"
                data-testid="accessible-plan-list-collapsed"
                onClick={() => onExpandCollapsedGroup(row.parentPlanNodeId)}
              >
                {formatHiddenNodeCountText(row.hiddenCount, "enter")}
              </button>
            </li>
          )
        }

        const severity = worstSeverity(row.node)
        const isSelected = row.node.id === selectedNodeId
        const comparisonStatus = comparisonOverlays?.get(row.node.id)?.status
        // Design review (downloaded "large execution plan node" PNG) — the
        // same operator icon PlanNodeCard/canvasDraw show, and the same
        // table/index subtitle (join-aware — buildSubtitle's own doc
        // comment), not a text-only row.
        const Icon = OPERATOR_ICON_COMPONENT[operatorIconKey(row.node.operatorType)]
        const subtitle = buildSubtitle(row.node)
        const badgeText = badgeTextFor(row.node) ?? (severity ? SEVERITY_LABEL[severity] : undefined)
        return (
          <li key={`${row.node.id}-${row.isSharedReference ? "ref" : "main"}`} style={{ paddingLeft: row.depth * 16 }}>
            <button
              type="button"
              className="accessible-plan-list__item"
              data-testid="accessible-plan-list-item"
              data-node-id={row.node.id}
              aria-current={isSelected ? "true" : undefined}
              onClick={() => onSelectNode(row.node.id)}
            >
              <Icon className="accessible-plan-list__icon" aria-hidden="true" />
              <span className="accessible-plan-list__label">{row.node.rawOperatorLabel}</span>
              {subtitle && <span className="accessible-plan-list__subtitle">{subtitle}</span>}
              {row.isSharedReference && <span className="accessible-plan-list__ref-note">(shared reference, see above)</span>}
              {formatMeta(row.node) && <span className="accessible-plan-list__meta">{formatMeta(row.node)}</span>}
              {badgeText && (
                <span
                  className={`accessible-plan-list__severity accessible-plan-list__severity--${severity ?? "info"}`}
                  data-testid="accessible-plan-list-severity"
                >
                  {badgeText}
                </span>
              )}
              {isSelected && <span className="accessible-plan-list__enter-hint">Enter opens details</span>}
              {comparisonStatus && comparisonStatus !== "matched" && (
                <span
                  className={`accessible-plan-list__comparison accessible-plan-list__comparison--${comparisonStatus}`}
                  data-testid="accessible-plan-list-comparison"
                >
                  {COMPARISON_LABEL[comparisonStatus]}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
