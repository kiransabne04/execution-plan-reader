# PlanReader

**Understand database execution plans without sending your queries anywhere.**

PlanReader is a free, privacy-first execution plan analyzer for **PostgreSQL, SQL Server, and Snowflake**.

Paste or upload an execution plan and PlanReader turns it into an interactive visualization with deterministic performance findings, Query Health, operator-level evidence, and plain-English explanations.

🌐 **Live:** https://www.planreader.dev

---

## Why PlanReader?

Database execution plans contain some of the most useful information for diagnosing query performance — but they can be difficult to read, especially when plans contain hundreds of operators.

PlanReader helps answer questions such as:

* Where is the query spending its time?
* Are row estimates significantly wrong?
* Is a join producing far more rows than expected?
* Is an operator spilling to disk?
* Is a PostgreSQL Nested Loop repeating expensive work?
* Is SQL Server performing excessive lookups?
* Is Snowflake scanning too many partitions?
* Is an operator processing far more data than it returns?
* Which part of a large execution plan should I investigate first?

Instead of simply visualizing the plan, PlanReader applies deterministic analysis rules and explains the evidence behind its findings.

---

# Supported Databases

## PostgreSQL

Supports PostgreSQL execution plans including:

* `EXPLAIN`
* `EXPLAIN ANALYZE`
* JSON plans
* TEXT plans
* buffer statistics
* planning/execution timing
* parallel execution information
* JIT statistics
* WAL statistics
* sort information
* hash statistics
* Memoize statistics
* partition-pruning information

PlanReader can identify patterns such as:

* severe cardinality estimation errors
* large selective sequential scans
* excessive rows removed by filters
* excessive rows removed by join filters
* Nested Loop explosions
* repeated inner-side execution
* disk-based sorts
* hash batching
* temporary I/O
* excessive Index Only Scan heap fetches
* ineffective Memoize usage
* repeated Materialize work
* parallel-worker shortfalls
* planning overhead
* JIT overhead
* partition-pruning issues
* WAL-heavy execution patterns
* buffer/cache inefficiencies

PlanReader deliberately avoids treating operators such as Sequential Scan or Nested Loop as inherently bad.

Context and materiality matter.

---

## SQL Server

PlanReader supports SQL Server Showplan XML, including complex and multi-statement plans.

Supported analysis includes execution-plan concepts such as:

* Index Seek
* Index Scan
* Clustered Index Scan
* Nested Loops
* Hash Match
* Merge Join
* Sort
* Key Lookup
* RID Lookup
* Table Spool
* Index Spool
* parallel operators
* memory/spill information
* optimizer-provided missing-index recommendations
* predicates
* estimates
* runtime statistics
* multi-statement procedures and batches

PlanReader only surfaces missing-index recommendations when the SQL Server optimizer actually provides the evidence.

It does not fabricate indexes merely because a scan appears in a plan.

---

## Snowflake

PlanReader supports execution operator statistics produced by Snowflake, including data obtained from:

```sql
SELECT *
FROM TABLE(GET_QUERY_OPERATOR_STATS('<query_id>'));
```

PlanReader understands Snowflake-specific execution concepts including:

* table scans
* joins
* filters
* aggregation
* sorting
* window operations
* partition pruning
* local spill
* remote spill
* network activity
* synchronization overhead
* bytes scanned
* cache statistics
* result transfer
* Search Optimization / Snowflake Optima pruning information
* DML statistics
* multi-step execution information

Snowflake analysis remains focused on the **execution operator profile supplied to PlanReader**.

Account-wide workload intelligence, warehouse optimization, query-history analysis and cost optimization are intentionally outside PlanReader's scope.

---

# Privacy First

Execution plans can contain sensitive information such as:

* SQL predicates
* table names
* schema names
* index names
* database names
* literal values
* internal application structures.

PlanReader is designed around a simple principle:

> **Your execution plans stay in your browser.**

Plan analysis happens client-side.

PlanReader does not require:

* database credentials
* database connectivity
* account registration
* uploading execution plans to an analysis server.

Recent-plan functionality uses browser-local storage where enabled.

### Shareable Plans

PlanReader can create shareable links containing a compressed representation of a plan.

The plan is encoded into the link itself rather than uploaded to a PlanReader analysis server.

Anyone who receives such a link may be able to view the embedded plan, so sensitive plans should be reviewed before sharing.

---

# Deterministic Analysis

PlanReader is intentionally not built around asking an LLM to guess what is wrong with a query.

Its core analysis uses deterministic rules operating on normalized execution-plan evidence.

Conceptually:

```text
Execution Plan
      │
      ▼
Engine Parser
      │
      ▼
Normalized Plan Model
      │
      ▼
Deterministic Rule Engine
      │
      ├── Findings
      ├── Evidence
      ├── Query Health
      └── Explanations
```

The same underlying architecture is used across PostgreSQL, SQL Server and Snowflake while preserving engine-specific semantics.

---

# Evidence Before Recommendations

PlanReader follows several principles when generating findings.

### An operator is not automatically a problem

A Sequential Scan can be correct.

A Nested Loop can be extremely efficient.

A Key Lookup can be harmless.

A large Snowflake scan can be intentional.

PlanReader considers the surrounding evidence before producing a finding.

### Materiality matters

A technically inefficient operation taking `0.05 ms` should not receive the same attention as one processing millions of rows for several seconds.

Rules consider available evidence such as:

* actual rows
* estimated rows
* execution time
* loops
* I/O
* spill volume
* partition pruning
* operator relationships.

### Missing evidence is not invented

If an execution plan does not provide enough information, PlanReader should say less rather than manufacture a diagnosis.

For example, a large PostgreSQL estimate error may justify investigating statistics, data skew, correlated columns or parameter values.

It does **not** prove that statistics are stale.

---

# Query Health

PlanReader summarizes significant findings into a Query Health assessment.

The score is intended to help identify which areas of a plan deserve attention first.

It is not intended to replace performance testing.

Always validate optimization changes against representative workloads.

---

# Interactive Plan Visualization

Execution plans are displayed as interactive operator graphs.

You can:

* inspect individual operators
* navigate parent/child relationships
* view operator statistics
* inspect predicates
* review findings
* focus problematic nodes
* explore large execution plans
* switch between statements in multi-statement plans.

Large plans can use an optimized Canvas-based renderer to remain usable even when hundreds of operators are present.

---

# Multi-Statement SQL Server Plans

SQL Server Showplans may contain many statements, particularly for stored procedures and batches.

PlanReader can parse these independently so a large procedure does not have to be treated as one enormous execution tree.

This makes it easier to identify the statements that deserve investigation first.

---

# Plan Comparison

PlanReader includes foundations for comparing execution plans.

Comparison can match operators between two versions of a plan and identify structural changes.

The long-term goal is to answer:

> **Why did this query get slower?**

rather than merely:

> **What changed between these two trees?**

Comparison functionality continues to evolve as PlanReader's diagnostic engine matures.

---

# Architecture

PlanReader follows an engine-adapter architecture.

```text
                    ┌───────────────────────┐
                    │    Execution Plan     │
                    └───────────┬───────────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
      PostgreSQL Parser   SQL Server Parser   Snowflake Parser
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Normalized Plan Model │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
          Rule Engine       Visualization     Comparison
              │
              ▼
       Findings / Health
```

This lets PlanReader share infrastructure while keeping database-specific interpretation where it belongs.

---

# Project Structure

The repository is broadly organized around:

```text
src/
├── parsers/
│   ├── postgres/
│   ├── sqlserver/
│   └── snowflake/
│
├── rules/
│
├── graph/
│
├── comparison/
│
├── persistence/
│
├── privacy/
│
└── ...
```

See the `/docs` directory for detailed architecture, parser specifications, backlog information and implementation notes.

---

# Running PlanReader Locally

Clone the repository:

```bash
git clone https://github.com/kiransabne04/execution-plan-reader.git
cd execution-plan-reader
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the local URL shown by Vite.

---

# Building

Create a production build:

```bash
npm run build
```

---

# Testing

PlanReader has automated coverage across parsers, deterministic rules, UI behavior and execution-plan workflows.

Run the available test suites using the scripts defined in `package.json`.

For example:

```bash
npm test
```

and, where configured:

```bash
npm run test:e2e
```

Before submitting changes, ensure:

* relevant unit tests pass
* parser fixtures pass
* rule tests pass
* E2E tests pass
* production build succeeds.

---

# Adding a New Analysis Rule

A good PlanReader rule should answer four questions:

### 1. What evidence exists?

Use actual execution-plan fields.

### 2. Is the behavior materially significant?

Avoid warnings based solely on operator existence.

### 3. What can we safely conclude?

Separate evidence from assumptions.

### 4. What should the user investigate?

Prefer actionable validation steps over unsupported prescriptions.

Every new rule should include:

* a positive fixture
* a healthy negative fixture
* a boundary case
* a missing-data case where relevant.

False-positive prevention is considered part of the feature.

---

# Development Philosophy

PlanReader prioritizes:

**Correctness over rule count**

**Evidence over assumptions**

**Low false-positive rates over aggressive recommendations**

**Database-specific reasoning over generic tuning advice**

**Privacy over server-side convenience**

**Deterministic analysis over AI guessing**

The goal is not to generate the largest number of warnings.

The goal is to identify the smallest number of findings that genuinely help explain the execution plan.

---

# Roadmap

PlanReader is actively evolving.

Current development areas include:

### Analyzer maturity

Deeper PostgreSQL, SQL Server and Snowflake diagnostics.

### Root-cause analysis

Connect related symptoms instead of presenting every warning independently.

For example:

```text
Cardinality Estimate Error
          │
          ▼
Nested Loop selected
          │
          ▼
Inner operator executed 500k times
          │
          ▼
Excessive I/O
```

### Golden execution-plan corpus

Build a large labelled corpus containing:

* healthy plans
* problematic plans
* edge cases
* real-world structures

across all three supported engines.

This will allow PlanReader to measure:

* parser reliability
* finding precision
* finding recall
* false-positive rate.

### Plan regression analysis

Improve before/after plan comparison to identify:

* plan-shape changes
* new findings
* resolved findings
* runtime regressions
* I/O regressions
* newly introduced spills.

### Query and plan fingerprints

Identify logically related query executions and plan-shape changes.

### Local performance history

Track execution-plan evolution locally without requiring server-side plan storage.

### Execution-plan sanitization

Allow sensitive information to be removed before sharing a plan.

### CLI

Future command-line usage may include:

```bash
planreader analyze plan.json
planreader compare before.json after.json
planreader lint plan.json
```

### CI performance gates

Longer-term CI workflows could detect execution-plan regressions before deployment.

---

# What PlanReader Is Not

PlanReader is not intended to replace:

* database monitoring platforms
* APM systems
* workload monitoring
* production observability
* DBA expertise
* representative performance testing.

It focuses specifically on:

> **Understanding and diagnosing execution plans.**

---

# Contributing

Contributions are welcome, particularly in:

* PostgreSQL execution-plan fixtures
* SQL Server Showplan fixtures
* Snowflake operator-statistics fixtures
* parser edge cases
* false-positive examples
* deterministic diagnostic rules
* accessibility
* performance
* documentation.
If contributing a new rule, please include both problematic and healthy examples.
A rule that catches a problem but incorrectly flags healthy plans is not complete.

---
# Reporting Incorrect Analysis

Execution-plan interpretation is nuanced.

If PlanReader produces a finding that you believe is incorrect, please open a GitHub issue with a sanitized execution plan and explain:
1. database engine and version;
2. PlanReader finding;
3. why you believe the finding is incorrect;
4. expected behavior.
False-positive reports are especially valuable.
They help improve the deterministic rule engine for everyone.

---
# Security & Privacy Reports
Please avoid posting sensitive production execution plans publicly.
Sanitize:
* credentials
* personal information
* confidential literals
* proprietary object names

before attaching execution plans to public issues.
---

# License
See the repository's `LICENSE` file for the current license terms.

---
# PlanReader
**Execution plans are complicated. Understanding them shouldn't be.**
Analyze PostgreSQL, SQL Server and Snowflake execution plans at:

https://www.planreader.dev
