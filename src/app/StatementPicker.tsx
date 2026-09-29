import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import type { PlanNode } from "../parsers/normalize"
import { SEVERITY_LABEL } from "../graph"
import { buildStatementTabRows, formatStatementDuration, statementSeverity } from "./statementTabSummary"

// Replaces the always-visible statement tab strip for multi-statement
// batches: one trigger showing the active statement + its metadata, opening
// a searchable listbox. Same data (`buildStatementTabRows`, duration,
// severity) as the tabs it replaces — a large stored-procedure batch no
// longer pushes the visualizer down the page.

export interface StatementPickerStatement {
  label: string
  root: PlanNode
}

interface StatementPickerProps {
  statements: StatementPickerStatement[]
  activeIndex: number
  expandedGroups: ReadonlySet<number>
  onToggleGroup: (start: number, expanded: boolean) => void
  onSelect: (index: number) => void
}

type PickerRow = { kind: "option"; index: number } | { kind: "group"; start: number; length: number; expanded: boolean }

function StatementMeta({ root }: { root: PlanNode }) {
  const duration = formatStatementDuration(root)
  const severity = statementSeverity(root)
  return (
    <>
      {duration && (
        <span className="statement-picker__duration" data-testid="statement-tab-duration">
          {duration}
        </span>
      )}
      {severity && (
        <>
          {/* Never color alone: critical is a circle, warning a diamond,
              plus a screen-reader-only text label (Story 18.11). */}
          <span
            className={`plan-reader-page__statement-tab-severity plan-reader-page__statement-tab-severity--${severity}`}
            data-testid="statement-tab-severity"
            aria-hidden="true"
          />
          <span className="plan-reader-page__sr-only">{SEVERITY_LABEL[severity]} severity</span>
        </>
      )}
    </>
  )
}

export function StatementPicker({ statements, activeIndex, expandedGroups, onToggleGroup, onSelect }: StatementPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const optionId = (i: number) => `${listId}-opt-${i}`

  const trimmed = query.trim().toLowerCase()
  const rows: PickerRow[] = useMemo(() => {
    if (trimmed) {
      // Searching flattens grouping: a match inside a collapsed control-flow
      // run must still be reachable.
      const matches: PickerRow[] = []
      statements.forEach((stmt, index) => {
        if (stmt.label.toLowerCase().includes(trimmed)) matches.push({ kind: "option", index })
      })
      return matches
    }
    return buildStatementTabRows(
      statements.map((s) => s.root),
      activeIndex,
      expandedGroups,
    ).map((row): PickerRow => (row.kind === "tab" ? { kind: "option", index: row.index } : row))
  }, [statements, activeIndex, expandedGroups, trimmed])

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    setQuery("")
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  const openPicker = () => {
    setOpen(true)
    const activeRow = rows.findIndex((r) => r.kind === "option" && r.index === activeIndex)
    setHighlight(activeRow === -1 ? 0 : activeRow)
  }

  useEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${listId}-opt-${highlight}`)?.scrollIntoView?.({ block: "nearest" })
  }, [open, highlight, listId])

  const activate = (row: PickerRow | undefined) => {
    if (!row) return
    if (row.kind === "group") {
      onToggleGroup(row.start, row.expanded)
      return
    }
    onSelect(row.index)
    close(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, rows.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === "Home") {
      e.preventDefault()
      setHighlight(0)
    } else if (e.key === "End") {
      e.preventDefault()
      setHighlight(Math.max(rows.length - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      activate(rows[highlight])
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
  }

  const active = statements[activeIndex]

  return (
    <div className="statement-picker" ref={rootRef} data-testid="statement-picker">
      <button
        ref={triggerRef}
        type="button"
        className="statement-picker__trigger"
        data-testid="statement-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Statement ${activeIndex + 1} of ${statements.length}: ${active?.label ?? ""}. Change statement`}
        onClick={() => (open ? close(false) : openPicker())}
      >
        <span className="statement-picker__count">
          {activeIndex + 1} of {statements.length}
        </span>
        <span className="statement-picker__label">{active?.label}</span>
        {active && <StatementMeta root={active.root} />}
        <span className="statement-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="statement-picker__panel">
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            className="statement-picker__search"
            data-testid="statement-picker-search"
            placeholder="Search statements"
            aria-label="Search statements"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? optionId(highlight) : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={onKeyDown}
          />
          <ul id={listId} role="listbox" aria-label="Statements in this batch" className="statement-picker__list">
            {rows.length === 0 && (
              <li className="statement-picker__empty" data-testid="statement-picker-empty">
                No statements match
              </li>
            )}
            {rows.map((row, i) => {
              const isHighlighted = i === highlight
              if (row.kind === "group") {
                const noun = `control-flow statement${row.length === 1 ? "" : "s"}`
                return (
                  <li
                    key={`group-${row.start}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={false}
                    aria-expanded={row.expanded}
                    className={`statement-picker__option statement-picker__option--group${isHighlighted ? " statement-picker__option--highlight" : ""}`}
                    data-testid="statement-tab-group"
                    onClick={() => activate(row)}
                    onMouseEnter={() => setHighlight(i)}
                  >
                    {row.expanded ? `Collapse ${row.length} ${noun}` : `${row.length} ${noun} — expand`}
                  </li>
                )
              }
              const stmt = statements[row.index]
              return (
                <li
                  key={stmt.label + row.index}
                  id={optionId(i)}
                  role="option"
                  aria-selected={row.index === activeIndex}
                  className={`statement-picker__option${row.index === activeIndex ? " statement-picker__option--active" : ""}${isHighlighted ? " statement-picker__option--highlight" : ""}`}
                  onClick={() => activate(row)}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="statement-picker__option-index">{row.index + 1}</span>
                  <span className="statement-picker__label">{stmt.label}</span>
                  <StatementMeta root={stmt.root} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
