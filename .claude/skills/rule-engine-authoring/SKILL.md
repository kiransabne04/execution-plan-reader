# Skill: Rule Engine Authoring

**Use this skill whenever writing, reviewing, or debugging code in `src/rules/`** — the plain-language warning generation layer that operates on the normalized `PlanNode` tree.

## Source of truth

Full requirements: `docs/technical-spec.md` §2, `docs/prd.md` (non-goals — parameter-sensitivity honesty note), `docs/episodes.md` Episode 5.

## Rule shape

Every rule is a pure function: `(node: PlanNode, context: PlanContext) -> Warning[]`. `PlanContext` carries whole-tree information a single-node rule might need (e.g. total plan cost, for relative-severity scoring). Rules must be:

- **Independently unit-testable** — no shared mutable state between rules.
- **Deterministic** — same input always produces the same output. (This matters beyond testing: it's what makes the LLM narrative mode, which phrases rule output rather than generating findings itself, trustworthy — see `docs/technical-spec.md` §2.)
- **Two-way tested** — every rule needs both a fixture that should trigger it and a fixture that should *not*. False positives erode user trust as much as missed detections; don't only test the positive case.

## MVP rule set (build these first)

1. Sequential/full scan on a large table — **threshold on table size, not scan-type presence.** A seq scan on a small table is often the *correct*, fastest plan; a blanket "seq scan = bad" rule is a well-known beginner misconception this tool exists to correct, not reinforce.
2. Bad row estimate (estimate vs. actual mismatch beyond a threshold).
3. Disk spill (works differently per engine — see engine-specific notes below).
4. Nested loop join blowup (high loop count with high per-loop cost).
5. Exploding join (output rows far exceeding input rows).
6. Missing/unused index opportunity, where derivable from available data.

## Required suppressions — do not let these misfire

- `BitmapAnd` / `BitmapOr` nodes always report `actual rows = 0` on Postgres. The row-estimate-mismatch rule must explicitly exclude these node types, or it will falsely flag every one of them.
- Cumulated parallel-worker / multi-loop timing figures can make a node look far slower than its real per-execution cost. Any time-based rule must use per-worker/normalized time where the parser has preserved it (see `postgres-plan-parsing` and `sqlserver-plan-parsing` skills), and must explicitly label cumulated figures as cumulated wherever only a raw sum is available — never present a cumulated number as if it were a single execution's duration.

## The parameter-sensitivity honesty rule

A single pasted plan is one snapshot of one execution. It cannot, by construction, diagnose parameter sniffing (SQL Server) or plan instability from Snowflake's dynamic cost-based optimizer. When a rule detects signals consistent with a parameterized query or an unusually-shaped plan for its apparent purpose, attach the honesty note rather than a false-confidence diagnosis:

> "This reflects one specific run — if this query is sometimes fast and sometimes slow, a different plan may be used for different input values, which a single pasted plan can't show you."

Do not build a rule that claims to detect parameter sniffing itself — that's out of scope by design (see `docs/prd.md` non-goals). The honesty note is a disclosure, not a diagnosis.

## Warning shape

Each `Warning` should carry **both a short and a long-form text** at authoring time (not generated live) — this feeds both the default beginner-depth UI and the Expert-depth toggle (see `graph-visualization` skill) from the same deterministic rule output, and keeps the LLM narrative mode's input bounded and testable.

```ts
interface Warning {
  ruleId: string
  severity: "info" | "warning" | "critical"
  shortText: string     // beginner-depth default
  longText: string      // expert-depth / detail panel
  learnMoreUrl?: string // link into existing @scalingbackend content, when available
}
```

## Testing checklist for any change in this directory

- [ ] Positive fixture (rule should fire) and negative fixture (rule should not fire) both exist.
- [ ] Snapshot test on a full representative plan asserts the *exact* set of warnings produced — catches unintended regressions when thresholds are tuned.
- [ ] Any rule touching timing/loop data has an explicit test against a parallel-worker or multi-loop fixture confirming it doesn't misfire on cumulated figures.
- [ ] Numeric edge cases (zero, NaN, negative, extremely large costs) don't throw or produce garbled warning text — treat as "insufficient data," never propagate `NaN` into user-facing strings.
