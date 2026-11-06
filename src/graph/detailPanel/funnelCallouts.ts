import type { Engine } from "../../parsers/normalize"

export interface FunnelCallout {
  product: "walstack-postgres" | "walstack-sqlserver" | "walstack-snowflake"
  text: string
  cta: string
  url: string
}

// Fixed destinations only. Never derive a URL from plan data, findings,
// location.href, or the share-link fragment (which contains the raw plan).
export const WALSTACK_POSTGRES_URL =
  "https://walstack.io/postgresql-performance-investigation?utm_source=planreader&utm_medium=tool&utm_campaign=postgres_plan_handoff"
export const WALSTACK_SQLSERVER_URL =
  "https://walstack.io/sql-server-performance?utm_source=planreader&utm_medium=tool&utm_campaign=sqlserver_plan_handoff"
export const WALSTACK_SNOWFLAKE_URL =
  "https://walstack.io/snowflake-performance?utm_source=planreader&utm_medium=tool&utm_campaign=snowflake_plan_handoff"
export const WALSTACK_SAMPLE_REPORT_URL =
  "https://walstack.io/sample-report?utm_source=planreader&utm_medium=tool&utm_campaign=postgres_plan_handoff"
export const WALSTACK_CREATOR_URL =
  "https://walstack.io/about?utm_source=planreader&utm_medium=tool&utm_campaign=creator_credit"

const CALLOUTS: Record<Engine, FunnelCallout> = {
  postgres: {
    product: "walstack-postgres",
    text: "A plan shows one execution. Persistent latency, CPU, locks, or connection pressure may need a production workload investigation.",
    cta: "See the PostgreSQL investigation",
    url: WALSTACK_POSTGRES_URL,
  },
  sqlserver: {
    product: "walstack-sqlserver",
    text: "If this SQL Server issue persists across the workload, WalStack can review the wider performance context.",
    cta: "See SQL Server performance help",
    url: WALSTACK_SQLSERVER_URL,
  },
  snowflake: {
    product: "walstack-snowflake",
    text: "If query performance varies beyond this Snowflake plan, WalStack can review the wider workload.",
    cta: "See Snowflake performance help",
    url: WALSTACK_SNOWFLAKE_URL,
  },
}

export function getFunnelCallout(engine: Engine): FunnelCallout {
  return CALLOUTS[engine]
}

export function getSummaryHandoffText(engine: Engine, hasFindings: boolean): string {
  if (engine === "postgres") {
    return hasFindings
      ? "A plan shows one execution. If latency, CPU, locks, or connection pressure persist, WalStack can investigate the workload and rank safe changes."
      : "No rule fired in this plan, but a clean plan does not rule out a production problem. If latency, CPU, locks, or connection pressure persist, WalStack can investigate the workload and rank safe changes."
  }
  return hasFindings
    ? CALLOUTS[engine].text
    : `No rule fired in this plan, but a clean plan does not rule out a production problem. ${CALLOUTS[engine].text}`
}
