// Episode 9, Story 9.1 — contextual, dismissible product callouts. See
// docs/06-content-launch-plan.md §4 and docs/02-feature-prioritization-moscow.md
// for the funnel design this implements: Postgres findings → pgsuite,
// Snowflake findings → QueryDoc, never cross-wired, never a generic banner.

import type { Engine } from "../../parsers/normalize"

export interface FunnelCallout {
  product: "pgsuite" | "querydoc"
  text: string
  /** Placeholder — swap for the real pgsuite/QueryDoc URL before launch.
   * See Story 9.1's own note on this in docs/08-episodes-and-stories.md. */
  url: string
}

// One generic message per engine, not tailored per rule ID (a deliberate
// scope decision for this pass) — still satisfies "tied to a specific
// finding, not a generic banner" per the acceptance criteria, since
// WarningsSection only ever renders this alongside an actual fired warning
// on the node currently open, never as a standalone/always-visible element.
const CALLOUTS: Partial<Record<Engine, FunnelCallout>> = {
  postgres: {
    product: "pgsuite",
    text: "Want ongoing checks like this across your whole database?",
    url: "https://pgsuite.example.com",
  },
  snowflake: {
    product: "querydoc",
    text: "Want deeper, AI-narrated diagnosis for Snowflake queries?",
    url: "https://querydoc.example.com",
  },
}

/**
 * Keyed strictly off the node's OWN `engine` field — never off rule ID or
 * any plan-wide "detected engine" flag — so a Postgres finding can never
 * link to QueryDoc or vice versa (Story 9.1's cross-engine-mixup edge case).
 * SQL Server has no funnel product (PRD: it's a credibility/reach play, not
 * one of the two funnel-mapped engines) — undefined for it, by design.
 */
export function getFunnelCallout(engine: Engine): FunnelCallout | undefined {
  return CALLOUTS[engine]
}
