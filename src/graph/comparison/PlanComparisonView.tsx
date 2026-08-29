// Episode 14, Story 14.2 — the comparison view: two plans rendered with the
// same PlanGraph/dagre/canvas pipeline Episode 6/15 already built (no
// forked rendering logic — graph-visualization skill), overlaid with the
// Story 14.1 match result, synced selection between the two panes, and a
// plain-language summary strip. See docs/08-episodes-and-stories.md
// Episode 14.

import { useCallback, useMemo, useState } from "react"
import { collectNodes, type PlanNode } from "../../parsers/normalize"
import type { PlanContext } from "../../rules/types"
import { matchNodes, PlanComparisonError, type NodeMatch } from "../../comparison/matchNodes"
import { buildComparisonSummary } from "../../comparison/summary"
import { PlanGraph } from "../PlanGraph"
import type { ComparisonOverlay } from "../buildGraphElements"
import "./planComparisonView.css"

export interface PlanComparisonViewProps {
  planA: PlanNode
  planB: PlanNode
  /** The rule-engine context each plan was analyzed with, so each pane's
   * detail panel sees the same statement text/totals the single-plan view
   * would — same contract as `PlanGraphProps.context`. */
  contextA?: PlanContext
  contextB?: PlanContext
  /** e.g. "Before" / "After", or a filename — defaults are deliberately
   * generic since the caller usually has something more specific (see
   * PlanReaderPage's usage). */
  labelA?: string
  labelB?: string
}

type ComparisonResult = { ok: true; matches: NodeMatch[] } | { ok: false; error: PlanComparisonError }

function computeComparison(planA: PlanNode, planB: PlanNode): ComparisonResult {
  try {
    return { ok: true, matches: matchNodes(planA, planB) }
  } catch (err) {
    // matchNodes only ever throws its own typed error (see matchNodes.ts) —
    // anything else would be a genuine bug, not a "these plans don't
    // compare" case, so it's deliberately not swallowed here.
    if (err instanceof PlanComparisonError) return { ok: false, error: err }
    throw err
  }
}

function toCounterpart(node: PlanNode | undefined): ComparisonOverlay["counterpart"] {
  if (!node) return undefined
  return { rawOperatorLabel: node.rawOperatorLabel, estimatedCost: node.estimatedCost, actualTimeMs: node.actualTimeMs }
}

export function PlanComparisonView({ planA, planB, contextA, contextB, labelA = "Plan A", labelB = "Plan B" }: PlanComparisonViewProps) {
  const comparison = useMemo(() => computeComparison(planA, planB), [planA, planB])

  const [orientation, setOrientation] = useState<"side-by-side" | "stacked">("side-by-side")
  const [focusInA, setFocusInA] = useState<string | undefined>(undefined)
  const [focusInB, setFocusInB] = useState<string | undefined>(undefined)
  // Story 14.1's edge case: clicking an addedInB/removedFromB node has no
  // counterpart to sync to at all — this surfaces that as a real UI state,
  // not a silent no-op.
  const [noMatchNotice, setNoMatchNotice] = useState<string | null>(null)

  // Full node lookup, only needed to build each `changed` node's
  // counterpart summary (Seq Scan -> Index Scan, cost/time delta) — the
  // match result itself only carries ids.
  const nodesById = useMemo(() => {
    if (!comparison.ok) return { a: new Map<string, PlanNode>(), b: new Map<string, PlanNode>() }
    return { a: new Map(collectNodes(planA).map((n) => [n.id, n])), b: new Map(collectNodes(planB).map((n) => [n.id, n])) }
  }, [comparison.ok, planA, planB])

  const { overlaysA, overlaysB, matchAtoB, matchBtoA } = useMemo(() => {
    const overlaysA = new Map<string, ComparisonOverlay>()
    const overlaysB = new Map<string, ComparisonOverlay>()
    const matchAtoB = new Map<string, string>()
    const matchBtoA = new Map<string, string>()
    if (!comparison.ok) return { overlaysA, overlaysB, matchAtoB, matchBtoA }

    for (const m of comparison.matches) {
      if (m.nodeIdA && m.nodeIdB) {
        matchAtoB.set(m.nodeIdA, m.nodeIdB)
        matchBtoA.set(m.nodeIdB, m.nodeIdA)
      }
      if (m.nodeIdA) {
        overlaysA.set(m.nodeIdA, {
          status: m.status,
          counterpart: m.status === "changed" ? toCounterpart(nodesById.b.get(m.nodeIdB ?? "")) : undefined,
        })
      }
      if (m.nodeIdB) {
        overlaysB.set(m.nodeIdB, {
          status: m.status,
          counterpart: m.status === "changed" ? toCounterpart(nodesById.a.get(m.nodeIdA ?? "")) : undefined,
        })
      }
    }
    return { overlaysA, overlaysB, matchAtoB, matchBtoA }
  }, [comparison, nodesById])

  const summary = useMemo(
    () => (comparison.ok ? buildComparisonSummary(comparison.matches, planA, planB) : null),
    [comparison, planA, planB],
  )

  // Synced selection (AC: "clicking a node in one plan selects and scrolls
  // to its matched counterpart in the other"): each pane's own PlanGraph
  // reports its selection here via onNodeSelected; this looks up the
  // counterpart and drives it into the OTHER pane's focusNodeId. See
  // PlanGraph.tsx's onNodeSelected/pendingPanNodeId for the pan-to-node half.
  const handleSelectInA = useCallback(
    (nodeId: string | undefined) => {
      if (nodeId === undefined) return
      const counterpart = matchAtoB.get(nodeId)
      if (counterpart) {
        setFocusInB(counterpart)
        setNoMatchNotice(null)
      } else {
        setNoMatchNotice(`No corresponding node in ${labelB}.`)
      }
    },
    [matchAtoB, labelB],
  )

  const handleSelectInB = useCallback(
    (nodeId: string | undefined) => {
      if (nodeId === undefined) return
      const counterpart = matchBtoA.get(nodeId)
      if (counterpart) {
        setFocusInA(counterpart)
        setNoMatchNotice(null)
      } else {
        setNoMatchNotice(`No corresponding node in ${labelA}.`)
      }
    },
    [matchBtoA, labelA],
  )

  if (!comparison.ok) {
    // Story 14.1's cross-engine edge case, surfaced here rather than
    // attempting to force a match: a clear, specific message instead of a
    // blank or broken comparison view.
    return (
      <div className="plan-comparison-view plan-comparison-view--error" role="alert" data-testid="plan-comparison-error">
        <p>{comparison.error.message}</p>
      </div>
    )
  }

  return (
    <div className="plan-comparison-view" data-testid="plan-comparison-view">
      <div className="plan-comparison-view__summary" data-testid="comparison-summary">
        <p className="plan-comparison-view__headline">{summary!.headline}</p>
        {summary!.lowConfidenceWarning && (
          <p className="plan-comparison-view__low-confidence" role="status" data-testid="comparison-low-confidence">
            {summary!.lowConfidenceWarning}
          </p>
        )}
      </div>

      <div className="plan-comparison-view__toolbar">
        <button
          type="button"
          className="plan-comparison-view__orientation-toggle"
          data-testid="comparison-orientation-toggle"
          onClick={() => setOrientation((o) => (o === "side-by-side" ? "stacked" : "side-by-side"))}
        >
          {orientation === "side-by-side" ? "Stack plans" : "Show side by side"}
        </button>
      </div>

      {noMatchNotice && (
        <p className="plan-comparison-view__no-match" role="status" data-testid="comparison-no-match-notice">
          {noMatchNotice}
        </p>
      )}

      <div className={`plan-comparison-view__panes plan-comparison-view__panes--${orientation}`}>
        <div className="plan-comparison-view__pane">
          <h3 className="plan-comparison-view__pane-label">{labelA}</h3>
          <PlanGraph
            root={planA}
            context={contextA}
            comparisonOverlays={overlaysA}
            focusNodeId={focusInA}
            onFocusHandled={() => setFocusInA(undefined)}
            onNodeSelected={handleSelectInA}
          />
        </div>
        <div className="plan-comparison-view__pane">
          <h3 className="plan-comparison-view__pane-label">{labelB}</h3>
          <PlanGraph
            root={planB}
            context={contextB}
            comparisonOverlays={overlaysB}
            focusNodeId={focusInB}
            onFocusHandled={() => setFocusInB(undefined)}
            onNodeSelected={handleSelectInB}
          />
        </div>
      </div>
    </div>
  )
}
