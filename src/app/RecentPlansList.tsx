// Episode 17, Story 17.2 — a capped, locally-stored list of recently
// analyzed plans. Collapsed by default behind a toggle, same pattern as
// Episode 13's FindingsList — not clutter for a first-time visitor, and
// not rendered at all when there's nothing to show yet.

import { useState } from "react"
import type { RecentPlanEntry } from "../persistence"

export interface RecentPlansListProps {
  plans: RecentPlanEntry[]
  onSelect: (text: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  /** Story 6.3 — when this list renders inside the icon rail's own
   * "Recent plans" overlay panel, that panel's icon click is already the
   * one and only expand/collapse gesture needed; this component's own
   * toggle button would just be a redundant second collapse layer inside
   * an already-opened panel. Omitted (default false): every pre-existing
   * caller/test keeps today's own toggle-then-expand behavior unchanged. */
  hideOwnToggle?: boolean
}

export function RecentPlansList({ plans, onSelect, onDelete, onClearAll, hideOwnToggle = false }: RecentPlansListProps) {
  const [expanded, setExpanded] = useState(false)

  if (plans.length === 0) return null

  const isOpen = hideOwnToggle || expanded

  return (
    <section className="recent-plans-list" data-testid="recent-plans-list">
      {!hideOwnToggle && (
        <button
          type="button"
          className="recent-plans-list__toggle"
          aria-expanded={expanded}
          data-testid="recent-plans-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide recent plans" : `Recent plans (${plans.length})`}
        </button>
      )}

      {isOpen && (
        <div className="recent-plans-list__body">
          <ul className="recent-plans-list__items">
            {plans.map((plan) => (
              <li key={plan.id} className="recent-plans-list__item">
                <button
                  type="button"
                  className="recent-plans-list__item-button"
                  data-testid="recent-plan-item"
                  onClick={() => onSelect(plan.text)}
                >
                  {plan.label}
                </button>
                <button
                  type="button"
                  className="recent-plans-list__item-delete"
                  data-testid="recent-plan-delete"
                  aria-label={`Delete "${plan.label}" from recent plans`}
                  onClick={() => onDelete(plan.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="recent-plans-list__clear-all" data-testid="recent-plans-clear-all" onClick={onClearAll}>
            Clear all
          </button>
        </div>
      )}
    </section>
  )
}
