# QueryGraph

QueryGraph has two local-only modes:

- **Query Logic** parses PostgreSQL or MySQL SQL into a simplified logical diagram and deterministic Query Health findings. It is not the database's physical execution order.
- **Execution Plan** parses PostgreSQL `EXPLAIN (FORMAT JSON)` output into the physical plan tree, node details, and conservative Plan Health findings.

## Features

- PostgreSQL and MySQL parsing modes
- Flow diagrams for SELECT, CTE, INSERT, UPDATE, DELETE, and common clause patterns
- Source-to-node highlighting between the SQL editor and graph
- Optional schema DDL input for index-aware access path hints
- Curated examples for join, write-safety, determinism, and indexing problems
- Typed Query Health findings with stable rule IDs, evidence, explanations, and rewrite directions
- Finding-to-SQL and finding-to-graph navigation
- Node detail panels with plain-language explanations
- Local-only parsing with no database connection required
- Self-contained, crawler-visible share pages with privacy-safe social previews
- PostgreSQL estimated and analyzed execution-plan visualization at `/explain`
- Plan details for costs, actual per-loop metrics, filtering, buffers, I/O, sorting, hashing, and workers

Query Health reports high-confidence query structure and DDL-based estimates. It never claims to be an actual `EXPLAIN`; confirm performance changes with the target database and production-like data.

## PostgreSQL execution plans

Generate an estimated plan without running the statement:

```sql
EXPLAIN (FORMAT JSON)
SELECT ...;
```

Generate observed runtime and buffer metrics:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT ...;
```

`EXPLAIN ANALYZE` executes the statement. `INSERT`, `UPDATE`, `DELETE`, and
functions with side effects can modify data. QueryGraph itself never executes
the SQL or connects to a database; plan parsing and findings stay in the
browser.

The execution-plan mode accepts the standard one-element PostgreSQL JSON array
and unambiguous plan objects. Text, YAML, XML, SQL-only input, and MySQL
`EXPLAIN` are not supported. MySQL execution plans are future work.

Limits are 2 MB of UTF-8 input, 1,000 nodes, and a maximum depth of 100. Cost is
shown as planner cost units, not milliseconds. Actual node times are inclusive
and may be per-loop averages, so QueryGraph does not sum them to invent a total.
Plans without `ANALYZE` or `BUFFERS` do not receive fabricated runtime or buffer
metrics.

Execution-plan sharing is intentionally deferred: plans commonly contain
relation/index names, predicates, literal values, and operational details, and
large plans are a poor fit for the existing self-contained URL format. No
remote storage was introduced.

Each finding declares its category, confidence, and evidence source. See
[QUERY_HEALTH_CAPABILITIES.md](QUERY_HEALTH_CAPABILITIES.md) for implemented
coverage and the explicit boundary between browser-local analysis and concerns
that require a live database or application context.

## Sharing and privacy

New share links use this versioned route:

```text
/share/v2/<deflate-compressed-base64url-payload>
```

The payload contains the selected dialect, SQL, optional schema DDL,
schema-panel state, and a validated aggregate preview summary. It is compressed
with DEFLATE and encoded with URL-safe Base64. Encoding is not encryption:
anyone who receives the URL can recover the SQL and DDL. Query parsing and Query
Health analysis still run in the visitor's browser; there is no database,
account, expiring snapshot, analytics, or remote share storage.

Social crawlers can read server-rendered Open Graph and Twitter metadata from
the share route. Metadata and the dynamic SVG preview use only allowlisted
aggregate values (dialect, statement type, logical-step count, table count,
major clause categories, and finding counts). They never include SQL, DDL,
comments, identifiers, or literal values. Share pages are marked `noindex,
nofollow`.

Existing `#q=` version 1 links remain supported. Opening one does not rewrite
browser history. The link is upgraded to the v2 route only after an explicit
Share action.

### Self-contained link limits

- SQL: 32,768 UTF-8 bytes
- DDL: 32,768 UTF-8 bytes
- Total decoded payload: 72,000 bytes
- Encoded payload: 15,000 URL characters
- Complete generated URL: 15,900 characters

The URL ceiling stays below Cloudflare Workers' 16 KB request-URL limit.
QueryGraph rejects corrupt, unsupported, oversized, and non-UTF-8 payloads.
Oversized content is never truncated or uploaded; the editor remains intact so
the user can copy the SQL or reduce the included schema.

## Development

Install dependencies:

```bash
pnpm install
```

Start the local dev server:

```bash
pnpm dev
```

Build for production:

```bash
pnpm build
```

Run the test suite:

```bash
pnpm test
```

Run linting and formatting checks:

```bash
pnpm check
```

Format the codebase:

```bash
pnpm format
```

## Project Structure

- `src/components` contains the editor, graph, node cards, details panel, and modal UI.
- `src/lib/ast` converts parser output into the internal query pipeline model.
- `src/lib/schema` parses optional DDL used by access path analysis.
- `src/lib/access-path` derives scan and index hints from schema metadata.
- `src/lib/query-health` contains presentation-independent rule evaluation and finding types.
- `src/lib/explain` contains PostgreSQL plan parsing, normalized types, metrics, examples, explanations, and Plan Health rules.
- `src/lib/examples.ts` contains the gallery's stable example definitions.
- `src/lib/__tests__` contains parser, schema, narration, and integration coverage.
- `e2e` contains Playwright coverage for the browser workflow.

## Deployment

The app is configured for Cloudflare Workers through the Cloudflare Vite plugin and `wrangler.jsonc`.

```bash
pnpm run deploy
```

## License

This project is open source under the MIT License. Anyone is welcome to use, modify, and contribute to QueryGraph.

When referencing this work, please mention the `querygraph` repository.
