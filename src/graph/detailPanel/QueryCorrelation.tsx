export interface QueryCorrelationProps {
  queryText?: string
  queryTextRedacted?: boolean
}

/**
 * Panel section 7 ("Query correlation") — additive, never required (see
 * graph-visualization skill). Scope note: this shows the available query
 * text as-is; it does NOT attempt to highlight the specific clause
 * corresponding to this node — every existing tool's attempt at that is
 * "rudimentary" per the technical spec, and a real solve needs genuine
 * SQL-to-plan correlation logic that's separate, larger, not-yet-started
 * work. Showing the honest text (or the honest reason it's missing) is the
 * additive value this pass delivers.
 */
export function QueryCorrelation({ queryText, queryTextRedacted }: QueryCorrelationProps) {
  return (
    <section className="detail-panel__section" data-testid="query-correlation">
      <h3 className="detail-panel__section-heading">Query</h3>
      {queryText ? (
        <pre className="detail-panel__query-text">{queryText}</pre>
      ) : queryTextRedacted ? (
        <p className="detail-panel__stat-gap" data-testid="query-text-unavailable">
          Query text redacted by account policy.
        </p>
      ) : (
        <p className="detail-panel__stat-gap" data-testid="query-text-unavailable">
          No query text available for this plan.
        </p>
      )}
    </section>
  )
}
