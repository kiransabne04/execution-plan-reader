import type { PlanNode } from "../../parsers/normalize"
import { buildStatRows } from "./buildStatRows"

export interface StatsTableProps {
  node: PlanNode
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
      <table className="detail-panel__stats-table">
        <tbody>
          {rows.map((row) => (
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
    </section>
  )
}
