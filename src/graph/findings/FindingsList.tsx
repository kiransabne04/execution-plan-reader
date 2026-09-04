// Episode 13, Story 13.1 — the complete findings view: every Warning the
// rule engine produced. Design review (reference mock): shown directly,
// filters and all, rather than behind a "See all N findings" toggle — see
// .claude/skills/rule-engine-authoring/SKILL.md and
// .claude/skills/graph-visualization/SKILL.md.

import { useMemo, useState } from "react"
import type { Warning } from "../../parsers/normalize"
import { collectFindingsAcrossStatements, type BatchFinding, type FindingsSource } from "../../rules/findings"
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
  /** Story 6.3 — "list" (default) is this component's original always-
   * been-this-way rendering: an "Issues · N" header, and each finding as
   * its own full-card severity treatment (colored border/background,
   * shortText on its own line). "compact" reuses 100% of the same
   * filtering/data logic above — only the row markup changes, to a single
   * line (severity dot + truncated shortText + category), for the new
   * findings drawer (`FindingsDrawer.tsx`), which already shows its own
   * "N findings · N critical · ..." summary line outside this component
   * (so this component's own header would be redundant there) and needs
   * to stay usable at real-world counts (dozens of findings) that the
   * full-card treatment doesn't scale to. Every existing caller (the
   * maximized-mode Issues toggle, Episode 22) omits this and keeps the
   * original "list" rendering unchanged — including Episode 26, Story
   * 26.3's own statement-grouping below, which is scoped to the "compact"
   * drawer specifically (the AC's own wording), not this variant. */
  variant?: "list" | "compact"
}

type SeverityFilter = "all" | Warning["severity"]
type CategoryFilter = "all" | FindingCategory

const SEVERITY_LABEL: Record<Warning["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}

export function FindingsList({ sources, activeStatementIndex, onSelectNode, variant = "list" }: FindingsListProps) {
  const isCompact = variant === "compact"
  const allFindings = useMemo(() => collectFindingsAcrossStatements(sources), [sources])

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")

  // Episode 26, Story 26.3 — which statement groups are collapsed, keyed by
  // `statementIndex`. Absent from the set = expanded (the default, so
  // opening the drawer shows everything without an extra click) — a plain
  // local `Set`, same "component-only state, not persisted or lifted"
  // scope as this story's own drag-resize height below.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const toggleGroup = (statementIndex: number) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(statementIndex)) next.delete(statementIndex)
      else next.add(statementIndex)
      return next
    })

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
    setCollapsedGroups(new Set())
  }

  const categoriesPresent = FINDING_CATEGORY_ORDER.filter((category) =>
    allFindings.some((f) => f.category === category),
  )

  const visible = allFindings.filter(
    (f) =>
      (severityFilter === "all" || f.warning.severity === severityFilter) &&
      (categoryFilter === "all" || f.category === categoryFilter),
  )

  // Story 26.3 — grouped by statement, scoped to the compact drawer variant
  // and only once there's more than one statement to group at all: "falls
  // back to a flat list for the single-statement case (most real input),
  // never an empty single group header wrapping everything." Built from
  // `visible` (the FILTERED set), not `allFindings` — a statement with no
  // findings matching the current filters gets no group header, matching
  // this component's own existing "zero findings" empty-state convention
  // rather than rendering a pointless empty group.
  const isGrouped = isCompact && sources.length > 1
  const groups = isGrouped
    ? (() => {
        const byStatement = new Map<number, { statementIndex: number; statementLabel: string; findings: BatchFinding[] }>()
        for (const finding of visible) {
          const existing = byStatement.get(finding.statementIndex)
          if (existing) existing.findings.push(finding)
          else byStatement.set(finding.statementIndex, { statementIndex: finding.statementIndex, statementLabel: finding.statementLabel, findings: [finding] })
        }
        return Array.from(byStatement.values()).sort((a, b) => a.statementIndex - b.statementIndex)
      })()
    : null

  function renderRow(finding: BatchFinding, index: number) {
    // Only meaningful (and only shown) once there's more than one
    // statement to distinguish between — a plain single-statement plan's
    // findings list looks exactly as it did before this story. Still shown
    // inside a statement GROUP too (Story 26.3): the group header says
    // which statement a row belongs to, but this badge answers a
    // different question — whether clicking it will jump you away from
    // the statement you're currently viewing.
    const isElsewhere = sources.length > 1 && finding.statementIndex !== activeStatementIndex
    const key = `${finding.statementIndex}-${finding.nodeId}-${finding.warning.ruleId}-${index}`
    if (isCompact) {
      // Story 6.3 — a single-line row: a severity dot (never color alone —
      // the dot is additionally labeled for screen readers, and the text
      // itself still names the severity via SEVERITY_LABEL below), the
      // shortText (truncated by CSS `text-overflow: ellipsis`, not
      // string-sliced — the full text is still in the DOM for a screen
      // reader, a tooltip, or a wider viewport), and the category. No card
      // padding/border/tint — this is what keeps this list usable at
      // dozens of findings.
      return (
        <li key={key}>
          <button
            type="button"
            className={`findings-list__item findings-list__item--compact-row findings-list__item--${finding.warning.severity}`}
            data-testid="finding-item"
            title={finding.warning.shortText}
            onClick={() => onSelectNode(finding.statementIndex, finding.nodeId)}
          >
            <span
              className={`findings-list__severity-dot findings-list__severity-dot--${finding.warning.severity}`}
              aria-hidden="true"
            />
            <span className="findings-list__sr-only">{SEVERITY_LABEL[finding.warning.severity]}</span>
            <span className="findings-list__text findings-list__text--compact">{finding.warning.shortText}</span>
            <span className="findings-list__category findings-list__category--compact">{finding.category}</span>
            {isElsewhere && (
              <span className="findings-list__statement-badge" data-testid="finding-statement-badge">
                {finding.statementLabel}
              </span>
            )}
          </button>
        </li>
      )
    }
    return (
      <li key={key}>
        <button
          type="button"
          className={`findings-list__item findings-list__item--${finding.warning.severity}`}
          data-testid="finding-item"
          onClick={() => onSelectNode(finding.statementIndex, finding.nodeId)}
        >
          <span className="findings-list__item-header">
            <span className={`findings-list__severity-label findings-list__severity-label--${finding.warning.severity}`}>
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
  }

  return (
    <section className={`findings-list${isCompact ? " findings-list--compact" : ""}`} data-testid="findings-list">
      {!isCompact && (
        <div className="findings-list__header">
          <h2 className="findings-list__title">
            Issues <span className="findings-list__count">· {allFindings.length}</span>
          </h2>
          <span className="findings-list__sort-label">By severity</span>
        </div>
      )}

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
          ) : groups ? (
            // Story 26.3 — one collapsible group per statement that
            // actually has a visible finding.
            <div className="findings-list__groups" data-testid="findings-list-groups">
              {groups.map((group) => {
                const isGroupOpen = !collapsedGroups.has(group.statementIndex)
                return (
                  <div key={group.statementIndex} className="findings-list__group" data-testid="findings-list-group">
                    <button
                      type="button"
                      className="findings-list__group-header"
                      aria-expanded={isGroupOpen}
                      data-testid="findings-list-group-header"
                      onClick={() => toggleGroup(group.statementIndex)}
                    >
                      <span className="findings-list__group-label">{group.statementLabel}</span>
                      <span className="findings-list__group-count">{group.findings.length}</span>
                    </button>
                    {isGroupOpen && <ul className="findings-list__items">{group.findings.map((finding, index) => renderRow(finding, index))}</ul>}
                  </div>
                )
              })}
            </div>
          ) : (
            // Not virtualized: no fixture in this codebase remotely
            // approaches the hundreds-of-items range where a plain list
            // would become the bottleneck. Revisit (react-window or
            // similar) if a real plan surfaces that many — see Episode
            // 13's edge-case table.
            <ul className="findings-list__items">{visible.map((finding, index) => renderRow(finding, index))}</ul>
          )}
        </>
      )}
    </section>
  )
}
