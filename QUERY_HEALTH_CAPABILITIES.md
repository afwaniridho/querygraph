# Query Health capability matrix

Query Health is deterministic, browser-local static analysis. It evaluates parsed
PostgreSQL or MySQL structure, the logical graph, source spans, and optional
schema DDL. It does not connect to a database and never represents an actual
`EXPLAIN` plan.

## Evidence model

| Confidence | Meaning |
| --- | --- |
| Definite | Directly proven by query syntax and SQL semantics. |
| High | A reliable static warning with a documented semantic or planner caveat. |
| Estimate | Depends on the supplied DDL or a simplified access-path model. |

Findings also identify their evidence as query structure, schema, or heuristic.
Schema findings are only as complete as the DDL supplied by the user.

## Implemented coverage

| Area | Implemented checks |
| --- | --- |
| Correctness | NULL equality/inequality, NULL in a `NOT IN` list, nullable `NOT IN` subqueries, right-side `LEFT JOIN` filters in `WHERE`, DDL-supported join duplication, impossible `IS NULL` checks on `NOT NULL` columns |
| Write safety | `UPDATE` and `DELETE` without `WHERE`, constant-true write filters, destructive `TRUNCATE`/`DROP TABLE` statements |
| Determinism | `LIMIT` without `ORDER BY`, non-unique ordering with `LIMIT` when DDL proves no unique tie-breaker, PostgreSQL `DISTINCT ON` without deterministic prefix-compatible ordering |
| Performance | Cartesian products, leading-wildcard `LIKE`, indexed-column expressions, composite-index prefix mismatch, estimated full scans, OFFSET pagination, random ordering |
| Maintainability | `SELECT *`, positional `INSERT` without a column list, potentially redundant `DISTINCT` after grouping |
| Aggregation and portability | MySQL projections that are neither grouped nor aggregated |
| Dialects | Every applicable rule is tested for PostgreSQL and MySQL; dialect-only rules declare their applicability |

## Deliberately deferred or context-dependent

| Concern | Why browser-local static analysis cannot prove it | Evidence needed |
| --- | --- | --- |
| Actual scan/join/sort strategy and cost | Optimizers use statistics, settings, available operators, and runtime parameters | `EXPLAIN`/`EXPLAIN ANALYZE`, server version and settings |
| Index selectivity and whether an index is worthwhile | DDL does not contain value distribution or table size | Statistics and representative data |
| Parameter sniffing/generic plan behavior | Depends on prepared-statement lifecycle and parameter values | Driver/runtime behavior and planner observations |
| Lock duration, deadlocks, and blocking | Depends on concurrent transactions and access order | Transaction traces and workload |
| Isolation anomalies and transaction boundaries | A standalone statement does not reveal application transaction scope | Application transaction code and isolation level |
| Permissions, row-level security, and data exposure | Effective identity and server policy are absent | Roles, grants, RLS policies and execution identity |
| SQL injection | Literal SQL alone does not reveal how text was constructed | Application source and parameter binding |
| Result correctness against business intent | Intent, invariants, and expected data are external | Requirements, fixtures and domain constraints |
| Trigger, cascade and generated-column side effects | Optional DDL parser does not model full server behavior | Complete deployed schema and server metadata |
| Function volatility, expression-index equivalence, collations | Dialect extensions and server configuration affect semantics | Server catalog and configuration |
| Partition pruning | Partition definitions and planner behavior are not modeled | Complete partition DDL and `EXPLAIN` |
| Data-dependent join cardinality | Keys can bound duplication, but fan-out magnitude depends on data | Constraints, statistics and representative data |
| Recursive CTE termination or growth | Termination depends on values and recursive logic | Data, recursion limits and runtime observation |
| Query timeout, memory spill, network and result size | Resource limits and row counts are unknown | Runtime metrics and server configuration |

## Extension policy

New rules must have a stable ID, category, severity, confidence, evidence type,
dialect applicability, explanation, remediation, and false-positive boundary
tests. Rules that cannot provide specific evidence should remain in the deferred
matrix rather than becoming speculative warnings.
