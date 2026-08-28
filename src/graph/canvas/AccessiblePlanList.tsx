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

import type { PlanNode, Warning } from "../../parsers/normalize"
import { countDescendants } from "../buildGraphElements"
import "./accessiblePlanList.css"

export interface AccessiblePlanListProps {
  root: PlanNode
  collapsedIds: Set<string>
  selectedNodeId?: string
  onSelectNode: (nodeId: string) => void
  onExpandCollapsedGroup: (parentPlanNodeId: string) => void
}

type ListRow =
  | { kind: "node"; node: PlanNode; depth: number; isSharedReference: boolean }
  | { kind: "collapsed"; parentPlanNodeId: string; depth: number; hiddenCount: number }

const SEVERITY_RANK: Record<Warning["severity"], number> = { critical: 0, warning: 1, info: 2 }
const SEVERITY_LABEL: Record<Warning["severity"], string> = { critical: "Critical", warning: "Warning", info: "Info" }

function worstSeverity(node: PlanNode): Warning["severity"] | undefined {
  if (node.warnings.length === 0) return undefined
  return node.warnings.reduce<Warning["severity"]>(
    (worst, w) => (SEVERITY_RANK[w.severity] < SEVERITY_RANK[worst] ? w.severity : worst),
    node.warnings[0].severity,
  )
}

function formatMeta(node: PlanNode): string {
  const rows = node.actualRows ?? node.estimatedRows
  const time = node.actualTimeMs
  const parts: string[] = []
  if (rows !== undefined) parts.push(`${rows.toLocaleString("en-US")} rows`)
  if (time !== undefined) parts.push(`${time.toFixed(1)}ms`)
  return parts.join(" · ")
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
                {row.hiddenCount.toLocaleString("en-US")} hidden node{row.hiddenCount === 1 ? "" : "s"} — expand
              </button>
            </li>
          )
        }

        const severity = worstSeverity(row.node)
        const isSelected = row.node.id === selectedNodeId
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
              <span className="accessible-plan-list__label">{row.node.rawOperatorLabel}</span>
              {row.isSharedReference && <span className="accessible-plan-list__ref-note">(shared reference, see above)</span>}
              {formatMeta(row.node) && <span className="accessible-plan-list__meta">{formatMeta(row.node)}</span>}
              {severity && (
                <span
                  className={`accessible-plan-list__severity accessible-plan-list__severity--${severity}`}
                  data-testid="accessible-plan-list-severity"
                >
                  {SEVERITY_LABEL[severity]}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
