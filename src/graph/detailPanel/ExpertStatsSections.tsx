import { memo, useMemo } from "react"
import type { PlanNode } from "../../parsers/normalize"
import { buildExpertSections } from "./buildExpertSections"
import type { StatRow } from "./buildStatRows"

export interface ExpertStatsSectionsProps {
  node: PlanNode
}

type Chunk = { kind: "table"; rows: StatRow[] } | { kind: "block"; row: StatRow }

// Same long-text-gets-its-own-block treatment as StatsTable.tsx's own
// chunkRows — a Scan internals section's Filter condition can be long
// enough that cramming it into the narrow value column reads badly.
function chunkRows(rows: StatRow[]): Chunk[] {
  const chunks: Chunk[] = []
  for (const row of rows) {
    if (row.isLongText) {
      chunks.push({ kind: "block", row })
      continue
    }
    const last = chunks[chunks.length - 1]
    if (last?.kind === "table") last.rows.push(row)
    else chunks.push({ kind: "table", rows: [row] })
  }
  return chunks
}

/**
 * Design review (downloaded "expert overlay details" PNG), spec §1f:
 * Expert mode's numbers, grouped into named sections ("Rows & estimates",
 * "Cost & timing", "Buffers", operator internals, "Parallelism", "Output
 * columns") rather than Beginner's single flat "This node's numbers" table
 * (`StatsTable`, unchanged, still what Beginner renders). Row derivation is
 * pure/tested (`buildExpertSections.ts`) — this component only renders the
 * result, same division of labor as `StatsTable`/`buildStatRows.ts`.
 */
function ExpertStatsSectionsInner({ node }: ExpertStatsSectionsProps) {
  const sections = useMemo(() => buildExpertSections(node), [node])
  const hasMismatch = node.warnings.some((w) => w.ruleId === "bad-row-estimate")

  if (sections.length === 0) return null

  return (
    <>
      {sections.map((section) => (
        <section className="detail-panel__section" data-testid="expert-stats-section" key={section.heading}>
          <h3 className="detail-panel__section-heading">{section.heading}</h3>
          {section.freeText ? (
            <pre className="detail-panel__raw-attributes">{section.freeText}</pre>
          ) : (
            chunkRows(section.rows ?? []).map((chunk, i) =>
              chunk.kind === "table" ? (
                <table key={i} className="detail-panel__stats-table">
                  <tbody>
                    {chunk.rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td
                          className={
                            row.isGap
                              ? "detail-panel__stat-gap"
                              : row.label === "Actual rows" && hasMismatch
                                ? "detail-panel__stat-mismatch"
                                : row.isWarning
                                  ? "detail-panel__stat-warning"
                                  : undefined
                          }
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div key={i} className="detail-panel__stat-block" data-testid="stat-block">
                  <div className="detail-panel__stat-block-label">{chunk.row.label}</div>
                  <pre className="detail-panel__stat-block-value">{chunk.row.value}</pre>
                </div>
              ),
            )
          )}
        </section>
      ))}
    </>
  )
}

// Story 16.1's memoization pattern, matching every other detail-panel
// section — cheap either way, but skips re-deriving on an unrelated
// DetailPanel re-render.
export const ExpertStatsSections = memo(ExpertStatsSectionsInner)
