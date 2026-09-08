import { memo } from "react"
import type { ParameterSignal } from "../../rules/types"

export interface ParameterValuesProps {
  parameters?: ParameterSignal[]
}

/**
 * Episode 29, Story 29.1 — Expert-only section (see `DetailPanel.tsx`'s own
 * Beginner/Expert branch), same "statement-wide fact, shown regardless of
 * which node is selected" placement `QueryCorrelation` already established.
 * SQL Server's compiled-vs-runtime parameter values — the compiled plan was
 * optimized for whichever value first compiled it, not necessarily this
 * run's own value, and that's often invisible without seeing both side by
 * side. Additive, never required: renders nothing at all (not even an
 * empty-state message) when the statement has no `ParameterList` — most
 * plans (non-parameterized queries, every non-SQL-Server engine) simply
 * don't have this, and an empty-state message for the common case would be
 * noise, not information (unlike `QueryCorrelation`'s query-text section,
 * which is expected on every plan and so DOES need an honest "unavailable"
 * state).
 */
function ParameterValuesInner({ parameters }: ParameterValuesProps) {
  if (!parameters || parameters.length === 0) return null

  return (
    <section className="detail-panel__section" data-testid="parameter-values">
      <h3 className="detail-panel__section-heading">Compiled vs. runtime parameters</h3>
      <table className="detail-panel__parameter-table">
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Compiled</th>
            <th scope="col">Runtime</th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((param) => {
            const differs = param.compiledValue !== undefined && param.runtimeValue !== undefined && param.compiledValue !== param.runtimeValue
            return (
              <tr key={param.name} className={differs ? "detail-panel__parameter-row--differs" : undefined}>
                <td>{param.name}</td>
                <td>{param.compiledValue ?? "—"}</td>
                <td>{param.runtimeValue ?? "—"}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

export const ParameterValues = memo(ParameterValuesInner)
