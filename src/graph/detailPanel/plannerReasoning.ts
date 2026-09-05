// Design review, spec §5 Beginner item 1: "'Why the planner chose it
// here' — the generation logic: which alternatives were costed, what the
// planner assumed, and what that implies for this node's timing."
//
// Deliberately NOT part of src/graph/glossary/ — the operator-glossary-
// content skill is explicit that a glossary entry "must never mention a
// specific plan's numbers, a specific table/column name, or phrases like
// 'this node' / 'here'." This is exactly that kind of content (per the
// mockup itself: "The planner had no usable index on the join key and
// expected the customers side to be small enough to hash..." — a real
// table name, a real assumption about THIS node), so it lives here
// instead, generated from the node's own already-normalized fields
// (relationIdentity/indexIdentity, estimatedRows/actualRows, join type,
// sort/hash spill info) — never a second, independent guess at data the
// rule engine or parsers already extracted.
//
// Coverage is intentionally bounded to the highest-frequency operator
// types (same "author the MVP set first, track the rest as a gap" rule
// the glossary skill itself uses) — an unmapped operatorType returns
// `undefined` and the panel simply omits this sub-section, the same
// honest-gap treatment as every other optional stat in this app. Never
// fabricate a generic sentence for an operator this hasn't been written
// for yet.

import type { PlanNode } from "../../parsers/normalize"
import { indexIdentity, relationIdentity } from "../../parsers/relationIdentity"

function estimateNote(node: PlanNode): string | undefined {
  if (node.estimatedRows === undefined || node.actualRows === undefined) return undefined
  if (node.estimatedRows <= 0) return undefined
  const ratio = node.actualRows / node.estimatedRows
  if (ratio >= 0.5 && ratio <= 2) return undefined // close enough not to be worth mentioning
  return ratio > 2
    ? `it expected far fewer rows here than actually came back`
    : `it expected far more rows here than actually came back`
}

export function getPlannerReasoning(node: PlanNode): string | undefined {
  const relation = relationIdentity(node)
  const index = indexIdentity(node)
  const estimateAside = estimateNote(node)

  switch (node.operatorType) {
    case "seq_scan":
      return index
        ? undefined
        : `${
            relation ? `No index on ${relation} covered this scan's condition, so` : "No usable index covered this scan's condition, so"
          } the planner read every row instead of seeking directly to the ones that matched${
            estimateAside ? ` — and ${estimateAside}, which changes how expensive that full read actually was` : ""
          }.`

    case "index_scan":
    case "index_only_scan":
      return `${index ? `An index (${index})` : "An index"} covered this condition cheaply enough that the planner chose to seek through it${
        relation ? ` on ${relation}` : ""
      } rather than read the whole table${estimateAside ? `, though ${estimateAside}` : ""}.`

    case "bitmap_heap_scan":
      return `The planner expected enough matching rows${
        relation ? ` in ${relation}` : ""
      } that seeking one at a time would cost more than building a bitmap of matches first and reading the table pages in physical order.`

    case "nested_loop_join":
      return `The planner expected the outer (driving) side to be small enough that searching the inner side once per outer row — ${
        index ? `via ${index}` : "ideally via an index"
      } — would be cheaper than building a hash table or sorting both sides first${
        estimateAside ? `. In practice, ${estimateAside}, which is exactly the case this join strategy handles worst` : "."
      }`

    case "hash_join": {
      const joinType = node.join?.logicalType
      return `The planner costed building an in-memory hash table from the smaller input${
        joinType ? ` (this is a ${joinType.replace(/_/g, " ")} join)` : ""
      } as cheaper than sorting both sides for a merge join, on the assumption the build side would fit in \`work_mem\`${
        node.hash?.batches !== undefined && node.hash.originalBatches !== undefined && node.hash.batches > node.hash.originalBatches
          ? ` — that assumption didn't hold: the hash table outgrew memory and split into ${node.hash.batches} batches instead of the planned ${node.hash.originalBatches}`
          : estimateAside
            ? `. In practice, ${estimateAside}`
            : "."
      }`
    }

    case "merge_join":
      return `Both inputs were already sorted (or cheap enough to sort) on the join key, so the planner chose a single synchronized pass over both sides instead of building a hash table.`

    case "sort":
      return `The planner estimated this sort's input would fit in \`work_mem\`${
        node.sort?.spaceType === "disk"
          ? ` — it didn't: the sort spilled to disk (${node.sort.method ?? "external sort"}) instead of finishing in memory`
          : node.sort?.method
            ? `, using ${node.sort.method}`
            : "."
      }`

    case "hash_aggregate":
      return `The planner expected few enough distinct groups${
        relation ? ` from ${relation}` : ""
      } to build an in-memory hash table of group keys, rather than sorting the input first and aggregating in one pass.`

    case "group_aggregate":
      return `The input arrived already sorted on the grouping key (or sorting it was cheap), so the planner aggregated in a single pass over the sorted rows instead of hashing groups in memory.`

    case "limit":
      return `Because only a limited number of rows are needed, the planner can stop pulling from its input as soon as that count is reached — the cost below reflects that early exit, not a full pass over the input.`

    default:
      return undefined
  }
}
