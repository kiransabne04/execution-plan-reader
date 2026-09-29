import { useMemo, useState } from "react"
import { parseStatisticsIo } from "../parsers/sqlserver/statisticsIo"
import { compareStatisticsIo, type MetricDelta, type TableStatus } from "../comparison/statisticsIo"
import "./statisticsIoComparePanel.css"

const STATUS_LABEL: Record<TableStatus, string> = {
  changed: "changed",
  unchanged: "unchanged",
  addedInAfter: "only in After",
  removedFromAfter: "only in Before",
}

function fmt(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString("en-US")
}

function changeText(m: { delta: number; percent?: number }): string {
  if (m.delta === 0) return "0"
  const sign = m.delta > 0 ? "+" : "−"
  const pct = m.percent === undefined ? "" : ` (${sign}${Math.abs(m.percent)}%)`
  return `${sign}${Math.abs(m.delta).toLocaleString("en-US")}${pct}`
}

// Every counter here is "lower is better" (reads, scans, segments read).
function trend(delta: number): "better" | "worse" | "same" {
  return delta < 0 ? "better" : delta > 0 ? "worse" : "same"
}

function MetricRows({ metrics }: { metrics: MetricDelta[] }) {
  return (
    <>
      {metrics.map((m) => (
        <tr key={m.key}>
          <td>{m.label}</td>
          <td className="sio-num">{fmt(m.before)}</td>
          <td className="sio-num">{fmt(m.after)}</td>
          <td className={`sio-num sio-change sio-change--${trend(m.delta)}`}>{changeText(m)}</td>
        </tr>
      ))}
    </>
  )
}

/**
 * Optional before/after `SET STATISTICS IO` comparison, shown next to the
 * plan comparison. Pure client-side parsing of two pasted text blocks —
 * nothing is saved, restored, or shared (same as the comparison plan).
 */
export function StatisticsIoComparePanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [beforeText, setBeforeText] = useState("")
  const [afterText, setAfterText] = useState("")

  const comparison = useMemo(() => {
    if (beforeText.trim() === "" || afterText.trim() === "") return null
    return compareStatisticsIo(parseStatisticsIo(beforeText), parseStatisticsIo(afterText))
  }, [beforeText, afterText])

  const unrecognized = useMemo(
    () => ({
      before: beforeText.trim() !== "" && parseStatisticsIo(beforeText).tables.length === 0,
      after: afterText.trim() !== "" && parseStatisticsIo(afterText).tables.length === 0,
    }),
    [beforeText, afterText],
  )

  return (
    <details className="sio-panel" data-testid="statistics-io-panel" open={defaultOpen || undefined}>
      <summary>Compare STATISTICS IO readings (optional)</summary>
      <p className="sio-help">
        Run <code>SET STATISTICS IO ON; SET STATISTICS TIME ON;</code> before each query, then paste the Messages output for the
        before and after runs. Parsed in your browser — nothing is uploaded.
      </p>
      <div className="sio-inputs">
        <label>
          Before
          <textarea
            data-testid="sio-before"
            value={beforeText}
            onChange={(e) => setBeforeText(e.target.value)}
            rows={6}
            placeholder="Table 'Orders'. Scan count 1, logical reads 48213, physical reads 3, …"
          />
        </label>
        <label>
          After
          <textarea
            data-testid="sio-after"
            value={afterText}
            onChange={(e) => setAfterText(e.target.value)}
            rows={6}
            placeholder="Table 'Orders'. Scan count 1, logical reads 412, physical reads 0, …"
          />
        </label>
      </div>

      {(unrecognized.before || unrecognized.after) && (
        <p className="sio-warning" role="alert" data-testid="sio-unrecognized">
          No STATISTICS IO lines found in {unrecognized.before && unrecognized.after ? "either box" : unrecognized.before ? "the Before box" : "the After box"}. Expected lines starting with “Table '…'. Scan count …”.
        </p>
      )}

      {comparison && (comparison.tables.length > 0 || comparison.time) && (
        <div className="sio-result" data-testid="sio-result">
          {comparison.headline && (
            <p className="sio-headline" data-testid="sio-headline">
              {comparison.headline}
            </p>
          )}
          <table className="sio-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="sio-num">Before</th>
                <th className="sio-num">After</th>
                <th className="sio-num">Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.totals.length > 0 && (
                <>
                  <tr className="sio-group">
                    <th colSpan={4}>All tables (total)</th>
                  </tr>
                  <MetricRows metrics={comparison.totals} />
                </>
              )}
              {comparison.tables.map((t) => (
                <TableGroup key={t.table} table={t.table} status={t.status} metrics={t.metrics} />
              ))}
              {comparison.time && (
                <>
                  <tr className="sio-group">
                    <th colSpan={4}>Time (STATISTICS TIME)</th>
                  </tr>
                  {comparison.time.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="sio-num">{fmt(row.before)}</td>
                      <td className="sio-num">{fmt(row.after)}</td>
                      <td className={`sio-num sio-change sio-change--${trend(row.delta)}`}>{changeText(row)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <p className="sio-help">Counters are summed per table across all statements in each paste. Lower is better.</p>
        </div>
      )}
    </details>
  )
}

function TableGroup({ table, status, metrics }: { table: string; status: TableStatus; metrics: MetricDelta[] }) {
  return (
    <>
      <tr className="sio-group">
        <th colSpan={4}>
          {table} <span className={`sio-status sio-status--${status}`}>{STATUS_LABEL[status]}</span>
        </th>
      </tr>
      <MetricRows metrics={metrics} />
    </>
  )
}
