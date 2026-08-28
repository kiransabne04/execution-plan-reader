// Episode 13, Story 13.1 — the complete findings view: every Warning the
// rule engine produced, unfiltered by default, kept deliberately separate
// from summarize.ts's short synthesized paragraph (which still does its own
// job elsewhere — see PlanReaderPage). Collapsed behind a toggle by default
// so a beginner isn't confronted with a wall of text on first load; the
// toggle IS the "explicit link/button into the complete list" the story
// calls for. See .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/graph-visualization/SKILL.md.

import { useMemo, useState } from "react"
import type { PlanNode, Warning } from "../../parsers/normalize"
import { collectAllFindings } from "../../rules/findings"
import { FINDING_CATEGORY_ORDER, type FindingCategory } from "../../rules/findingCategory"
import { NO_ISSUES_TEXT } from "../../rules/summarize"
import "./findingsList.css"

export interface FindingsListProps {
  root: PlanNode
  /** Called with the originating node's id when a finding entry is
   * clicked — the caller (PlanReaderPage) wires this into PlanGraph's
   * `focusNodeId` prop to navigate the graph and open that node's detail
   * panel. This component has no graph/panel knowledge of its own. */
  onSelectNode: (nodeId: string) => void
}

type SeverityFilter = "all" | Warning["severity"]
type CategoryFilter = "all" | FindingCategory

const SEVERITY_LABEL: Record<Warning["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}

function pluralize(count: number): string {
  return count === 1 ? "finding" : "findings"
}

export function FindingsList({ root, onSelectNode }: FindingsListProps) {
  const allFindings = useMemo(() => collectAllFindings(root), [root])

  const [expanded, setExpanded] = useState(false)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")

  // Reset per-plan UI state only when a genuinely new plan arrives (object
  // identity, not just an equal id) — same "adjust state during render"
  // pattern PlanGraph uses for its own collapse/selection state, and for
  // the same reason: a filter left over from the previous plan silently
  // hiding findings on a freshly pasted one would be confusing, but
  // clicking into a finding's node and back on the SAME plan must NOT
  // reset anything (Story 13.1's explicit edge case).
  const [prevRoot, setPrevRoot] = useState(root)
  if (root !== prevRoot) {
    setPrevRoot(root)
    setExpanded(false)
    setSeverityFilter("all")
    setCategoryFilter("all")
  }

  const categoriesPresent = FINDING_CATEGORY_ORDER.filter((category) =>
    allFindings.some((f) => f.category === category),
  )

  const visible = allFindings.filter(
    (f) =>
      (severityFilter === "all" || f.warning.severity === severityFilter) &&
      (categoryFilter === "all" || f.category === categoryFilter),
  )

  return (
    <section className="findings-list" data-testid="findings-list">
      <button
        type="button"
        className="findings-list__toggle"
        aria-expanded={expanded}
        data-testid="findings-list-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Hide all findings" : `See all ${allFindings.length} ${pluralize(allFindings.length)}`}
      </button>

      {expanded &&
        (allFindings.length === 0 ? (
          <p className="findings-list__empty" data-testid="findings-list-empty">
            {NO_ISSUES_TEXT}
          </p>
        ) : (
          <div className="findings-list__body">
            <div className="findings-list__filters">
              <label className="findings-list__filter-label">
                Severity
                <select
                  className="findings-list__filter-select"
                  data-testid="findings-severity-filter"
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </label>
              <label className="findings-list__filter-label">
                Category
                <select
                  className="findings-list__filter-select"
                  data-testid="findings-category-filter"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                >
                  <option value="all">All</option>
                  {categoriesPresent.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {visible.length === 0 ? (
              <p className="findings-list__no-match" data-testid="findings-list-no-match">
                No findings match these filters.
              </p>
            ) : (
              // Not virtualized: no fixture in this codebase remotely
              // approaches the hundreds-of-items range where a plain list
              // would become the bottleneck. Revisit (react-window or
              // similar) if a real plan surfaces that many — see Episode
              // 13's edge-case table.
              <ul className="findings-list__items">
                {visible.map((finding, index) => (
                  <li key={`${finding.nodeId}-${finding.warning.ruleId}-${index}`}>
                    <button
                      type="button"
                      className="findings-list__item"
                      data-testid="finding-item"
                      onClick={() => onSelectNode(finding.nodeId)}
                    >
                      <span
                        className={`findings-list__severity-badge findings-list__severity-badge--${finding.warning.severity}`}
                      >
                        {SEVERITY_LABEL[finding.warning.severity]}
                      </span>
                      <span className="findings-list__category">{finding.category}</span>
                      <span className="findings-list__text">{finding.warning.shortText}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </section>
  )
}
