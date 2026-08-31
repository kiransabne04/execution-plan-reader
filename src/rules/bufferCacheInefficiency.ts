// New rule (user-requested): a "shared_buffers"-style cache-efficiency
// signal, and its equivalent for SQL Server and Snowflake. See
// .claude/skills/rule-engine-authoring/SKILL.md and
// docs/10-node-stats-field-catalog.md §5 before editing.
//
// Postgres and SQL Server share ONE code path here: both already populate
// the same normalized `io.cacheHitRatio`/`io.bufferReads` shape (Postgres
// from Shared/Local Hit+Read Blocks — exact, when the plan was captured
// with BUFFERS; SQL Server from per-thread logical/physical reads — an
// approximation, stated as such per the field catalog, not presented with
// Postgres-level confidence).
//
// Snowflake has no per-node cache-hit field at all — cache-hit is a
// QUERY-level percentage there, not a per-operator one (field catalog
// §5). Its genuine equivalent, using data already on `PlanNode` today, is
// `timeBreakdown`'s local/remote-disk-IO percentage: a node whose own
// elapsed time was dominated by disk I/O rather than served from a warm
// cache is the same underlying phenomenon a low Postgres/SQL Server hit
// ratio describes, just measured a different way because that's what
// Snowflake actually exposes.

import type { PlanNode, Warning } from "../parsers/normalize"
import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Pages/blocks/reads floor — below this, even a 0% hit ratio is too small
 * a read volume to be worth flagging (a handful of cold-cache reads on a
 * tiny table is normal, not a problem). */
export const MIN_BUFFER_READS_THRESHOLD = 1_000

/** Common DBA rule-of-thumb concern line for a buffer/page cache hit
 * ratio — below this, the working set is no longer comfortably served
 * from memory. */
export const CACHE_HIT_RATIO_THRESHOLD = 0.9

/** Snowflake: share of THIS node's own elapsed time (not the whole
 * query's) spent on local+remote disk I/O rather than compute/warm-cache
 * access. */
export const SNOWFLAKE_DISK_IO_PERCENTAGE_THRESHOLD = 20

function checkHitRatio(node: PlanNode): Warning[] {
  const io = node.io
  if (!io || io.cacheHitRatio === undefined || io.bufferReads === undefined) return []
  if (io.bufferReads < MIN_BUFFER_READS_THRESHOLD) return []
  if (io.cacheHitRatio >= CACHE_HIT_RATIO_THRESHOLD) return []

  const hitPercent = Math.round(io.cacheHitRatio * 100)
  const readsText = formatNumber(io.bufferReads)
  const thresholdPercent = Math.round(CACHE_HIT_RATIO_THRESHOLD * 100)

  const longText =
    node.engine === "postgres"
      ? `This ${node.rawOperatorLabel} read ${readsText} blocks from disk — only ${hitPercent}% of its reads came ` +
        `from Postgres's shared_buffers cache. Below roughly ${thresholdPercent}%, the working set for this ` +
        `operation usually no longer fits comfortably in shared_buffers. A larger shared_buffers setting, a ` +
        `covering index that reads less data, or reducing the volume this operator scans are the usual fixes.`
      : `This ${node.rawOperatorLabel} performed ${readsText} physical reads — only ${hitPercent}% of its reads were ` +
        `served from SQL Server's buffer pool. This is an approximation from logical-vs-physical read counts, not an ` +
        `exact hit/miss split the way Postgres reports it, but a ratio this low usually means the buffer pool is ` +
        `under memory pressure for this working set. A larger buffer pool (more server memory), a covering index, ` +
        `or reducing the data volume this operator touches are the usual fixes.`

  return [
    {
      ruleId: "buffer-cache-inefficiency",
      severity: "warning",
      shortText: `Only ${hitPercent}% served from cache — ${readsText} read from disk.`,
      longText,
    },
  ]
}

function checkSnowflakeDiskIo(node: PlanNode): Warning[] {
  const tb = node.timeBreakdown
  if (!tb) return []

  const remote = tb.remoteDiskIoPercentage ?? 0
  const local = tb.localDiskIoPercentage ?? 0
  const diskShare = remote + local
  if (!Number.isFinite(diskShare) || diskShare < SNOWFLAKE_DISK_IO_PERCENTAGE_THRESHOLD) return []

  const diskShareText = `${Math.round(diskShare)}%`
  const parts: string[] = []
  if (remote > 0) parts.push(`${Math.round(remote)}% remote storage`)
  if (local > 0) parts.push(`${Math.round(local)}% local disk`)
  const breakdown = parts.join(", ")

  // Remote storage I/O is the more severe signal: it means even the
  // warehouse's own local SSD cache didn't have this data, not just that
  // it missed Snowflake's in-memory result/metadata cache.
  const remoteNote =
    remote > local
      ? " Remote storage reads (the larger share here) are the more expensive case — even the warehouse's local SSD cache didn't have this data."
      : ""

  return [
    {
      ruleId: "buffer-cache-inefficiency",
      severity: "warning",
      shortText: `${diskShareText} of this operator's time went to disk I/O, not warm-cache reads.`,
      longText:
        `Snowflake doesn't expose a per-operator cache-hit ratio the way Postgres/SQL Server do, but this ` +
        `${node.rawOperatorLabel}'s own execution-time breakdown shows ${diskShareText} (${breakdown}) went to disk ` +
        `I/O rather than being served warm.${remoteNote} A larger warehouse (more local SSD cache) or a more ` +
        `selective filter/better pruning to reduce the data volume scanned are the usual fixes.`,
    },
  ]
}

export const bufferCacheInefficiency: Rule = (node) => {
  if (node.engine === "snowflake") return checkSnowflakeDiskIo(node)
  return checkHitRatio(node)
}
