import type { PlanNode } from "../../parsers/normalize"
import { buildStatRows, type StatRow } from "./buildStatRows"

export interface StatsTableProps {
  node: PlanNode
}

type Chunk = { kind: "table"; rows: StatRow[] } | { kind: "block"; row: StatRow }

/** Groups rows into runs of compact table rows and full-width text blocks,
 * preserving order — a long free-text value (predicate/seek/join condition)
 * reads far better as its own wrapped block than crammed into the narrow
 * value column next to short numeric stats. */
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

/** Panel section 3 ("This node's numbers"). Row derivation is pure/tested
 * (buildStatRows.ts) — this component only renders the result. The
 * estimate-vs-actual mismatch highlight reuses the rule engine's own
 * bad-row-estimate finding rather than recomputing a second threshold. */
export function StatsTable({ node }: StatsTableProps) {
  const rows = buildStatRows(node)
  const hasMismatch = node.warnings.some((w) => w.ruleId === "bad-row-estimate")

  if (rows.length === 0) return null

  return (
    <section className="detail-panel__section" data-testid="stats-table">
      <h3 className="detail-panel__section-heading">This node's numbers</h3>
      {chunkRows(rows).map((chunk, i) =>
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
      )}
    </section>
  )
}
