// Before/after comparison of two parsed `STATISTICS IO` results (see
// src/parsers/sqlserver/statisticsIo.ts). Reads parsed counters only — no
// parsing of its own and no network calls.

import { IO_METRICS, type IoMetricKey, type StatisticsIoResult, type StatisticsTime, type TableIo } from "../parsers/sqlserver/statisticsIo"

export interface MetricDelta {
  key: IoMetricKey
  label: string
  before?: number
  after?: number
  /** `after - before`, treating a side that lacks the counter as 0 only
   * when the other side has it. */
  delta: number
  /** Undefined when `before` is 0/absent (no meaningful percentage). */
  percent?: number
}

export type TableStatus = "changed" | "unchanged" | "addedInAfter" | "removedFromAfter"

export interface TableComparison {
  table: string
  status: TableStatus
  /** Only counters present on at least one side. */
  metrics: MetricDelta[]
}

export interface StatisticsIoComparison {
  tables: TableComparison[]
  /** Counters summed across every table on each side. */
  totals: MetricDelta[]
  time?: { label: string; before?: number; after?: number; delta: number; percent?: number }[]
  /** e.g. "logical reads decreased by 92% (52,023 → 439)". */
  headline?: string
}

function deltaFor(key: IoMetricKey, label: string, before: number | undefined, after: number | undefined): MetricDelta | undefined {
  if (before === undefined && after === undefined) return undefined
  const b = before ?? 0
  const a = after ?? 0
  return { key, label, before, after, delta: a - b, percent: b > 0 ? Math.round(((a - b) / b) * 100) : undefined }
}

function metricsFor(before: TableIo | undefined, after: TableIo | undefined): MetricDelta[] {
  const out: MetricDelta[] = []
  for (const m of IO_METRICS) {
    const d = deltaFor(m.key, m.label, before?.[m.key], after?.[m.key])
    if (d) out.push(d)
  }
  return out
}

function sumTables(tables: TableIo[]): TableIo {
  const total: TableIo = { table: "Total" }
  for (const t of tables) {
    for (const m of IO_METRICS) {
      const v = t[m.key]
      if (v !== undefined) total[m.key] = (total[m.key] ?? 0) + v
    }
  }
  return total
}

function statusFor(before: TableIo | undefined, after: TableIo | undefined, metrics: MetricDelta[]): TableStatus {
  if (!before) return "addedInAfter"
  if (!after) return "removedFromAfter"
  return metrics.some((m) => m.delta !== 0) ? "changed" : "unchanged"
}

const TIME_FIELDS: { key: keyof StatisticsTime; label: string }[] = [
  { key: "cpuMs", label: "CPU time (ms)" },
  { key: "elapsedMs", label: "Elapsed time (ms)" },
  { key: "compileCpuMs", label: "Compile CPU time (ms)" },
  { key: "compileElapsedMs", label: "Compile elapsed time (ms)" },
]

function compareTime(before?: StatisticsTime, after?: StatisticsTime): StatisticsIoComparison["time"] {
  const rows: NonNullable<StatisticsIoComparison["time"]> = []
  for (const f of TIME_FIELDS) {
    const b = before?.[f.key]
    const a = after?.[f.key]
    if (b === undefined && a === undefined) continue
    rows.push({ label: f.label, before: b, after: a, delta: (a ?? 0) - (b ?? 0), percent: b ? Math.round((((a ?? 0) - b) / b) * 100) : undefined })
  }
  return rows.length > 0 ? rows : undefined
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}

function buildHeadline(totals: MetricDelta[]): string | undefined {
  const logical = totals.find((m) => m.key === "logicalReads")
  if (!logical || logical.before === undefined || logical.after === undefined) return undefined
  const range = `${formatCount(logical.before)} → ${formatCount(logical.after)}`
  if (logical.delta === 0) return `logical reads unchanged (${formatCount(logical.after)})`
  const direction = logical.delta < 0 ? "decreased" : "increased"
  return logical.percent === undefined
    ? `logical reads ${direction} (${range})`
    : `logical reads ${direction} by ${Math.abs(logical.percent)}% (${range})`
}

export function compareStatisticsIo(before: StatisticsIoResult, after: StatisticsIoResult): StatisticsIoComparison {
  const beforeByName = new Map(before.tables.map((t) => [t.table.toLowerCase(), t]))
  const afterByName = new Map(after.tables.map((t) => [t.table.toLowerCase(), t]))
  const names = [...new Set([...beforeByName.keys(), ...afterByName.keys()])]

  const tables: TableComparison[] = names.map((name) => {
    const b = beforeByName.get(name)
    const a = afterByName.get(name)
    const metrics = metricsFor(b, a)
    return { table: (b ?? a)!.table, status: statusFor(b, a, metrics), metrics }
  })
  // Biggest logical-read change first — the number a tuner looks at first.
  const logicalChange = (t: TableComparison) => Math.abs(t.metrics.find((m) => m.key === "logicalReads")?.delta ?? 0)
  tables.sort((x, y) => logicalChange(y) - logicalChange(x) || x.table.localeCompare(y.table))

  const totals = metricsFor(sumTables(before.tables), sumTables(after.tables))
  return { tables, totals, time: compareTime(before.time, after.time), headline: buildHeadline(totals) }
}
