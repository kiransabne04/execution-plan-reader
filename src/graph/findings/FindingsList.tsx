// Episode 13, Story 13.1 — the complete findings view: every Warning the
// rule engine produced. Design review (reference mock): shown directly,
// filters and all, rather than behind a "See all N findings" toggle — see
// .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/graph-visualization/SKILL.md.

import { useMemo, useState } from "react"
import type { Warning } from "../../parsers/normalize"
import { collectFindingsAcrossStatements, type FindingsSource } from "../../rules/findings"
import { FINDING_CATEGORY_ORDER, type FindingCategory } from "../../rules/findingCategory"
import { NO_ISSUES_TEXT } from "../../rules/summarize"
import "./findingsList.css"

export interface FindingsListProps {
  /** Story 20.4: every statement in the batch, not just the active one —
   * a large SQL Server stored-proc plan's findings were previously
   * scoped to whichever ONE statement happened to be selected, silently
   * hiding findings on the other statements (including ones sitting
   * inside a currently-collapsed control-flow group). A single-statement
   * plan (Postgres, Snowflake, most SQL Server input) just passes a
   * one-element array — no behavior change there. */
  sources: FindingsSource[]
  /** Which statement is currently open in the centre graph — findings
   * belonging to a DIFFERENT statement get a visible "jump to" label
   * (only shown at all when `sources.length > 1`), and this is compared
   * against each finding's own `statementIndex` to decide that. */
  activeStatementIndex: number
  /** Called with the originating statement's index and node id when a
   * finding entry is clicked — the caller (PlanReaderPage) is expected to
   * switch `activeStatementIndex` to the first argument (if it differs
   * from the current one) and wire the second into PlanGraph's
   * `focusNodeId` prop. This component has no graph/panel knowledge of
   * its own. */
  onSelectNode: (statementIndex: number, nodeId: string) => void
}

type SeverityFilter = "all" | Warning["severity"]
type CategoryFilter = "all" | FindingCategory

const SEVERITY_LABEL: Record<Warning["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}

export function FindingsList({ sources, activeStatementIndex, onSelectNode }: FindingsListProps) {
  const allFindings = useMemo(() => collectFindingsAcrossStatements(sources), [sources])

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")

  // Reset filters only when the SET of statement roots genuinely changes
  // (a fresh parse — object identity of the underlying roots, not just an
  // equal statement count) — same "adjust state during render" pattern
  // PlanGraph uses for its own collapse/selection state, and for the same
  // reason: a filter left over from the previous plan silently hiding
  // findings on a freshly pasted one would be confusing, but switching
  // which statement is active, or clicking into a finding's node and back
  // on the SAME plan, must NOT reset anything (Story 13.1's explicit edge
  // case, still true now that "the plan" means the whole batch).
  const rootsKey = sources.map((s) => s.root)
  const [prevRoots, setPrevRoots] = useState(rootsKey)
  const rootsChanged = rootsKey.length !== prevRoots.length || rootsKey.some((r, i) => r !== prevRoots[i])
  if (rootsChanged) {
    setPrevRoots(rootsKey)
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
      <div className="findings-list__header">
        <h2 className="findings-list__title">
          Findings <span className="findings-list__count">· {allFindings.length}</span>
        </h2>
        <span className="findings-list__sort-label">By severity</span>
      </div>

      {allFindings.length === 0 ? (
        <p className="findings-list__empty" data-testid="findings-list-empty">
          {NO_ISSUES_TEXT}
        </p>
      ) : (
        <>
          <div className="findings-list__filters">
            <select
              className="findings-list__filter-select"
              data-testid="findings-severity-filter"
              aria-label="Filter findings by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select
              className="findings-list__filter-select"
              data-testid="findings-category-filter"
              aria-label="Filter findings by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            >
              <option value="all">All categories</option>
              {categoriesPresent.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
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
              {visible.map((finding, index) => {
                // Only meaningful (and only shown) once there's more than
                // one statement to distinguish between — a plain single-
                // statement plan's findings list looks exactly as it did
                // before this story.
                const isElsewhere = sources.length > 1 && finding.statementIndex !== activeStatementIndex
                return (
                  <li key={`${finding.statementIndex}-${finding.nodeId}-${finding.warning.ruleId}-${index}`}>
                    <button
                      type="button"
                      className={`findings-list__item findings-list__item--${finding.warning.severity}`}
                      data-testid="finding-item"
                      onClick={() => onSelectNode(finding.statementIndex, finding.nodeId)}
                    >
                      <span className="findings-list__item-header">
                        <span
                          className={`findings-list__severity-label findings-list__severity-label--${finding.warning.severity}`}
                        >
                          {SEVERITY_LABEL[finding.warning.severity]}
                        </span>
                        <span className="findings-list__category">{finding.category}</span>
                        {isElsewhere && (
                          <span className="findings-list__statement-badge" data-testid="finding-statement-badge">
                            {finding.statementLabel}
                          </span>
                        )}
                      </span>
                      <span className="findings-list__text">{finding.warning.shortText}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
