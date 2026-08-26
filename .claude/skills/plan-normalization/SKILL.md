# Skill: Plan Tree Normalization

**Use this skill whenever writing, reviewing, or debugging code in `src/parsers/normalize.ts`**, or whenever adding/editing an engine-specific operator mapping table (`src/parsers/postgres/operatorMap.ts`, `src/parsers/sqlserver/operatorMap.ts`, `src/parsers/snowflake/operatorMap.ts`).

## Source of truth

Full requirements: `docs/technical-spec.md` §1.4 and §4, `docs/episodes.md` Episode 4.

## The `PlanNode` contract

```ts
interface PlanNode {
  id: string
  engine: "postgres" | "sqlserver" | "snowflake"
  operatorType: string          // normalized (e.g. "seq_scan", "index_scan", "hash_join")
  rawOperatorLabel: string      // original engine-specific label, ALWAYS preserved
  estimatedRows?: number
  actualRows?: number
  estimatedCost?: number
  actualTimeMs?: number
  loops?: number
  children: PlanNode[]
  attributes: Record<string, string | number>   // engine-specific extras, untouched
  warnings: Warning[]           // populated later, by the rule engine — not here
}
```

**The single most important rule of this file: normalization never discards information.** `rawOperatorLabel` and the full untouched `attributes` bag must always be present alongside the normalized fields, even for well-mapped, common operator types. This is what lets a Phase 2 feature (a new engine, a "show raw engine output" UI toggle) work without re-parsing anything.

## Operator mapping tables

Each engine has its own `nativeLabel -> operatorType` table. Rules:

1. **Every mapping table needs an explicit `unknown` fallback.** An operator type that isn't in the table must still produce a valid `PlanNode` — `operatorType: "unknown"`, with `rawOperatorLabel` set to whatever the engine called it, and the full `attributes` bag intact. Never throw, never silently drop the node.
2. **Don't force false equivalence across engines.** Some operator types genuinely have no cross-engine equivalent — Snowflake's `Flatten`, Postgres's `WindowAgg` vs. SQL Server's `Window Spool` are related but not identical in behavior. It's fine (correct, even) for the rule engine to have engine-specific rules where the underlying operator vocabularies genuinely diverge. Don't distort the mapping table to make everything look unified if that unification isn't accurate.
3. **Track "seen but unmapped" labels during development and testing.** When a new operator type shows up in a fixture or in soft-launch traffic that isn't in the table yet, that's a real gap to close, not something to silently absorb into `unknown` forever — but `unknown` handling must still work correctly in the meantime.

## Testing checklist for any change here

- [ ] Every operator type appearing anywhere in `fixtures/*/` resolves to either a known `operatorType` or the explicit `unknown` fallback — assert this as a suite-wide check, not per-fixture.
- [ ] Adding a new mapping entry includes a fixture exercising it.
- [ ] Confirm `rawOperatorLabel` and `attributes` survive normalization unchanged for at least one fixture per engine (a regression here is easy to introduce silently and easy to miss without an explicit assertion).
