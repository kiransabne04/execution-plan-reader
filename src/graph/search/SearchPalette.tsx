// Episode 18, Story 18.8 — the search/filter palette's UI. Pure presentation
// over searchNodes.ts's pure logic; PlanReaderPage owns the keyboard-
// shortcut wiring (global `/` and ⌘K/Ctrl+K) and the `matchedNodeIds` it
// feeds into PlanGraph — this component only knows "root in, selection out."
//
// "One source of truth for filter state" (this story's own AC line): the
// palette's severity filter is its OWN local state, not FindingsList's.
// They're conceptually different filters over different collections — one
// narrows a flat findings list, the other narrows which graph NODES stay at
// full opacity — and FindingsList has no reason to know the palette exists.
// What IS shared, deliberately, is the vocabulary: the same three severity
// values, the same labels, the same "all" default, so a user who's learned
// one filter's behavior doesn't have to re-learn the other's. See
// docs/12-ui-redesign-spec.md §5 `1h`.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { PlanNode, Warning } from "../../parsers/normalize"
import { relationIdentity, indexIdentity } from "../../parsers/relationIdentity"
import { searchNodes, type SeverityFilter } from "./searchNodes"
import "./searchPalette.css"

export interface SearchPaletteProps {
  root: PlanNode
  /** Fires with the chosen node's id, and closes the palette — the caller
   * wires this straight into PlanGraph's existing `focusNodeId` prop
   * (Story 13.1's findings-list click already established this pattern). */
  onSelectNode: (nodeId: string) => void
  onClose: () => void
  /** Fires whenever the active result set changes — `undefined` when no
   * query/filter is active (searchNodes.ts's own `isActive === false`) so
   * the caller can feed `undefined` straight through to PlanGraph's
   * `matchedNodeIds` (meaning "dim nothing"), otherwise the current
   * matched-id set. The dimming lives in PlanGraph/buildGraphElements, not
   * here — this only reports what should be highlighted. */
  onMatchedIdsChange?: (matchedIds: Set<string> | undefined) => void
}

// Same three values and labels FindingsList.tsx's own severity filter
// uses — see this file's module comment on why the vocabulary, not the
// state, is what's shared.
const SEVERITY_LABEL: Record<Warning["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
}
const SEVERITY_OPTIONS: SeverityFilter[] = ["all", "critical", "warning", "info"]

export function SearchPalette({ root, onSelectNode, onClose, onMatchedIdsChange }: SearchPaletteProps) {
  const [query, setQuery] = useState("")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const result = useMemo(() => searchNodes(root, query, severityFilter), [root, query, severityFilter])

  // Reset the highlighted row whenever the result set itself changes —
  // otherwise arrow-key navigation could leave the highlight parked past
  // the end of a just-narrowed list, or on a row that no longer exists.
  const [prevMatches, setPrevMatches] = useState(result.matches)
  if (result.matches !== prevMatches) {
    setPrevMatches(result.matches)
    setHighlightedIndex(0)
  }

  // Autofocus the query input on open — a palette a keyboard shortcut just
  // opened should be immediately typeable, not require an extra click.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Report the active result set outward so the caller can dim the graph
  // (Story 18.8's spec §5 `1h`), and clear it on unmount — closing the
  // palette (Escape, selecting a result, clicking the scrim) must not
  // leave the graph permanently dimmed behind it.
  useEffect(() => {
    onMatchedIdsChange?.(result.isActive ? result.matchedIds : undefined)
    return () => onMatchedIdsChange?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const selectResult = (node: PlanNode) => {
    onSelectNode(node.id)
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, result.matches.length - 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const target = result.matches[highlightedIndex]
      if (target) selectResult(target)
    }
  }

  return (
    // Story 18.8's own scrim: mousedown on the backdrop closes, same
    // pattern DetailPanel's shell overlay uses below 1180px
    // (planReaderPage.css's .plan-shell__detail-scrim) — a click meant to
    // dismiss shouldn't also register as a click on whatever's underneath.
    <div className="search-palette-scrim" data-testid="search-palette-scrim" onMouseDown={onClose}>
      <div
        className="search-palette"
        data-testid="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search plan nodes"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="search-palette__input"
          data-testid="search-palette-input"
          placeholder="Search operators, tables, indexes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
        />

        <div className="search-palette__filters">
          {SEVERITY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className="search-palette__chip"
              data-testid={`search-palette-severity-${option}`}
              aria-pressed={severityFilter === option}
              onClick={() => setSeverityFilter(option)}
            >
              {option === "all" ? "All" : SEVERITY_LABEL[option]}
            </button>
          ))}
        </div>

        {result.matches.length === 0 ? (
          <p className="search-palette__empty" data-testid="search-palette-no-matches">
            No matches.
          </p>
        ) : (
          <ul className="search-palette__results" id={listboxId} role="listbox" data-testid="search-palette-results">
            {result.matches.map((node, index) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="search-palette__result"
                  data-testid="search-palette-result"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  data-highlighted={index === highlightedIndex || undefined}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectResult(node)}
                >
                  <span className="search-palette__result-label">{node.rawOperatorLabel}</span>
                  {buildResultSubtitle(node) && (
                    <span className="search-palette__result-subtitle">{buildResultSubtitle(node)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Relation/index identity, same source Story 18.4's node-card subtitle
 * and searchNodes.ts's own searchable text both already read — no fourth
 * re-derivation. */
function buildResultSubtitle(node: PlanNode): string | undefined {
  return relationIdentity(node) ?? indexIdentity(node)
}
