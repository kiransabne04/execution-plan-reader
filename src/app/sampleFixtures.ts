// Design review, spec §6 `1d`: "New: sample buttons loading from
// src/fixtures/, one per engine, each chosen to fire a different rule."
// Vite's `?raw` import suffix bundles each fixture's literal text at BUILD
// time — no runtime `fetch`, so this stays within the privacy-architecture
// skill's no-network-calls rule for the rule-based path (the exact same
// guarantee the file-picker/drop path already relies on: a string handed
// straight to the existing `analyzePlanText`, no new parse path).
//
// One real fixture per engine, chosen to fire a distinct rule the same way
// the spec asks — labels describe what that FIXTURE actually contains,
// not the spec mockup's own placeholder numbers (which belong to a
// different, illustrative plan the mockup invented, not a real fixture in
// this repo).
import postgresExplodingJoin from "../fixtures/postgres/rule-exploding-join.json?raw"
import sqlserverKeyLookup from "../fixtures/sqlserver/seek-and-key-lookup.xml?raw"
import snowflakeRemoteSpill from "../fixtures/snowflake/spill-to-remote-disk.json?raw"

export interface SampleFixture {
  engine: "postgres" | "sqlserver" | "snowflake"
  engineLabel: string
  formatLabel: string
  description: string
  /** The fixture's own real filename under src/fixtures/ — shown in the
   * app-bar's filename slot once loaded (design review, header PNG
   * reference), same honest-name treatment a real dropped/picked file
   * gets, never an invented one. */
  filename: string
  text: string
}

export const SAMPLE_FIXTURES: readonly SampleFixture[] = [
  {
    engine: "postgres",
    engineLabel: "Postgres",
    formatLabel: "EXPLAIN JSON",
    description: "nested-loop join producing 500× more rows than estimated",
    filename: "rule-exploding-join.json",
    text: postgresExplodingJoin,
  },
  {
    engine: "sqlserver",
    engineLabel: "SQL Server",
    formatLabel: "Showplan XML",
    description: "index seek feeding a per-row key lookup",
    filename: "seek-and-key-lookup.xml",
    text: sqlserverKeyLookup,
  },
  {
    engine: "snowflake",
    engineLabel: "Snowflake",
    formatLabel: "Operator stats JSON",
    description: "aggregate spilling to remote storage",
    filename: "spill-to-remote-disk.json",
    text: snowflakeRemoteSpill,
  },
]
