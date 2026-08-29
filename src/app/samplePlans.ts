// Episode 18, Story 18.5 — one-click sample plans, one per engine, each
// chosen to fire a DIFFERENT rule so a first-time visitor immediately sees
// the tool doing something specific, not just rendering a graph. Real
// fixtures from src/fixtures/ (never fabricated demo content) bundled at
// BUILD time via Vite's `?raw` import — this stays fully client-side, no
// runtime fetch of any kind (privacy-architecture skill).
//
// Picked by actually running analyzePlanText against every fixture in the
// library and checking which rule(s) fired (not guessed from filenames) —
// see this story's own commit for the one-off probe that produced this list.

import postgresSample from "../fixtures/postgres/bitmap-and-or-zero-rows.json?raw"
import sqlServerSample from "../fixtures/sqlserver/missing-index-recommendation.xml?raw"
import snowflakeSample from "../fixtures/snowflake/spill-to-remote-disk.json?raw"

export interface SamplePlan {
  engine: "postgres" | "sqlserver" | "snowflake"
  /** Button label — names the engine and, briefly, what it demonstrates. */
  label: string
  text: string
}

export const SAMPLE_PLANS: SamplePlan[] = [
  { engine: "postgres", label: "Postgres — a bad row estimate", text: postgresSample },
  { engine: "sqlserver", label: "SQL Server — a missing index", text: sqlServerSample },
  { engine: "snowflake", label: "Snowflake — a disk spill", text: snowflakeSample },
]
