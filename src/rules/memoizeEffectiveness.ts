// Episode 24, Story 24.10 — Memoize cache effectiveness. Do not warn
// simply because Memoize exists (this story's own explicit instruction)
// — a Memoize node with too little lookup volume to judge, or one that's
// genuinely working well, gets no finding at all. Two independent
// findings, since a low hit rate and cache evictions are different
// problems with different fixes (a poor cache key / genuinely
// low-repetition workload vs. a cache that's too small for its working
// set).

import { formatNumber } from "./format"
import type { Rule } from "./types"

/** Below this many total lookups, hit-rate math is too noisy/low-sample
 * to be worth judging at all. */
export const MIN_LOOKUPS_THRESHOLD = 100

export const LOW_HIT_RATE_THRESHOLD = 0.5

/** Evictions as a share of total lookups, above which the cache is
 * meaningfully churning (too small for its working set), not just
 * occasionally recycling a rarely-reused entry. */
export const EVICTION_RATIO_THRESHOLD = 0.05

export const memoizeEffectiveness: Rule = (node) => {
  if (node.operatorType !== "memoize" || !node.memoize) return []
  const hits = node.memoize.cacheHits ?? 0
  const misses = node.memoize.cacheMisses ?? 0
  const totalLookups = hits + misses
  if (totalLookups < MIN_LOOKUPS_THRESHOLD) return []

  const warnings: Array<{ ruleId: string; severity: "info" | "warning" | "critical"; shortText: string; longText: string }> = []

  const hitRate = hits / totalLookups
  if (hitRate < LOW_HIT_RATE_THRESHOLD) {
    const percentText = `${Math.round(hitRate * 100)}%`
    warnings.push({
      ruleId: "memoize-low-hit-rate",
      severity: hitRate < 0.2 ? "warning" : "info",
      shortText: `Only ${percentText} cache hit rate (${formatNumber(hits)} hits, ${formatNumber(misses)} misses).`,
      longText:
        `This Memoize cache was hit ${formatNumber(hits)} times and missed ${formatNumber(misses)} times — a ${percentText} ` +
        `hit rate. A low hit rate means most lookups aren't finding a cached result, so the cache isn't saving much work ` +
        `for what it costs to maintain. This can mean the cache key doesn't repeat often enough in this data to be worth ` +
        `caching, or that the cache is being evicted before a value gets reused (see the eviction finding on this same ` +
        `node, if present).`,
    })
  }

  const evictions = node.memoize.cacheEvictions ?? 0
  if (evictions > 0 && evictions / totalLookups >= EVICTION_RATIO_THRESHOLD) {
    const memoryNote = node.memoize.peakMemoryKb !== undefined ? ` Peak memory usage was ${formatNumber(node.memoize.peakMemoryKb)} kB.` : ""
    warnings.push({
      ruleId: "memoize-evictions",
      severity: "warning",
      shortText: `${formatNumber(evictions)} cache entries evicted before reuse.`,
      longText:
        `This Memoize cache evicted ${formatNumber(evictions)} entries out of ${formatNumber(totalLookups)} total lookups ` +
        `— entries are being pushed out before they get reused.${memoryNote} This usually means the cache (sized from ` +
        `\`work_mem\`) is too small for this operation's actual working set of distinct cache keys — a larger \`work_mem\` ` +
        `for this query is the usual fix.`,
    })
  }

  return warnings
}
