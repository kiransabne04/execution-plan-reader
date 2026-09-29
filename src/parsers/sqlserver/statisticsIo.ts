// Parses pasted SQL Server `SET STATISTICS IO ON` (and optionally `SET
// STATISTICS TIME ON`) message output — the per-table reads a DBA compares
// before/after a tuning change. Pure text parsing: no network calls, and
// nothing here ever puts pasted text into a returned error/message (see
// the privacy-architecture skill) — unrecognized input just yields zero
// tables, which the UI reports structurally.

export interface TableIo {
  table: string
  /** Every counter is optional: older SQL Server versions omit the
   * `page server` fields, and only columnstore tables print `segment *`.
   * Absent stays `undefined` — never a fabricated 0. */
  scanCount?: number
  logicalReads?: number
  physicalReads?: number
  pageServerReads?: number
  readAheadReads?: number
  pageServerReadAheadReads?: number
  lobLogicalReads?: number
  lobPhysicalReads?: number
  lobPageServerReads?: number
  lobReadAheadReads?: number
  lobPageServerReadAheadReads?: number
  segmentReads?: number
  segmentSkipped?: number
}

export type IoMetricKey = Exclude<keyof TableIo, "table">

/** Display order + label for every counter; also the only source of truth
 * for the printed-label -> field mapping below. */
export const IO_METRICS: { key: IoMetricKey; label: string; printed: string }[] = [
  { key: "scanCount", label: "Scan count", printed: "scan count" },
  { key: "logicalReads", label: "Logical reads", printed: "logical reads" },
  { key: "physicalReads", label: "Physical reads", printed: "physical reads" },
  { key: "pageServerReads", label: "Page server reads", printed: "page server reads" },
  { key: "readAheadReads", label: "Read-ahead reads", printed: "read-ahead reads" },
  { key: "pageServerReadAheadReads", label: "Page server read-ahead reads", printed: "page server read-ahead reads" },
  { key: "lobLogicalReads", label: "LOB logical reads", printed: "lob logical reads" },
  { key: "lobPhysicalReads", label: "LOB physical reads", printed: "lob physical reads" },
  { key: "lobPageServerReads", label: "LOB page server reads", printed: "lob page server reads" },
  { key: "lobReadAheadReads", label: "LOB read-ahead reads", printed: "lob read-ahead reads" },
  { key: "lobPageServerReadAheadReads", label: "LOB page server read-ahead reads", printed: "lob page server read-ahead reads" },
  { key: "segmentReads", label: "Segment reads", printed: "segment reads" },
  { key: "segmentSkipped", label: "Segment skipped", printed: "segment skipped" },
]

const KEY_BY_PRINTED = new Map(IO_METRICS.map((m) => [m.printed, m.key]))

export interface StatisticsTime {
  /** Summed across every `SQL Server Execution Times` block. */
  cpuMs?: number
  elapsedMs?: number
  /** Summed across every `SQL Server parse and compile time` block. */
  compileCpuMs?: number
  compileElapsedMs?: number
}

export interface StatisticsIoResult {
  /** One entry per distinct table name (case-insensitive), counters summed
   * across every statement in the pasted batch — STATISTICS IO output has
   * no statement delimiter, so per-table totals are the reliable unit. */
  tables: TableIo[]
  time?: StatisticsTime
}

const TABLE_LINE = /^\s*Table\s+'(.*?)'\.\s*(.*)$/i
const TIME_LINE = /CPU time\s*=\s*(\d+)\s*ms\s*,\s*elapsed time\s*=\s*(\d+)\s*ms/i

function add(current: number | undefined, value: number): number {
  return (current ?? 0) + value
}

export function parseStatisticsIo(text: string): StatisticsIoResult {
  const byName = new Map<string, TableIo>()
  const time: StatisticsTime = {}
  let timeContext: "execution" | "compile" | undefined

  for (const line of text.split(/\r?\n/)) {
    const tableMatch = TABLE_LINE.exec(line)
    if (tableMatch) {
      const name = tableMatch[1].trim()
      const key = name.toLowerCase()
      const entry = byName.get(key) ?? { table: name }
      for (const part of tableMatch[2].split(",")) {
        const counter = /^\s*(.+?)\s+(\d+)\s*\.?\s*$/.exec(part)
        if (!counter) continue
        const field = KEY_BY_PRINTED.get(counter[1].toLowerCase())
        if (field) entry[field] = add(entry[field], Number(counter[2]))
      }
      byName.set(key, entry)
      continue
    }

    if (/parse and compile time/i.test(line)) {
      timeContext = "compile"
      continue
    }
    if (/SQL Server Execution Times/i.test(line)) {
      timeContext = "execution"
      continue
    }
    const timeMatch = timeContext ? TIME_LINE.exec(line) : null
    if (timeMatch && timeContext) {
      const cpu = Number(timeMatch[1])
      const elapsed = Number(timeMatch[2])
      if (timeContext === "compile") {
        time.compileCpuMs = add(time.compileCpuMs, cpu)
        time.compileElapsedMs = add(time.compileElapsedMs, elapsed)
      } else {
        time.cpuMs = add(time.cpuMs, cpu)
        time.elapsedMs = add(time.elapsedMs, elapsed)
      }
      timeContext = undefined
    }
  }

  const tables = [...byName.values()]
  return { tables, time: Object.keys(time).length > 0 ? time : undefined }
}
