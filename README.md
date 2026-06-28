# QueryGraph

QueryGraph is a local-only Guided Query Clinic for PostgreSQL and MySQL. Paste SQL or load a curated example to see a simplified logical processing diagram and deterministic Query Health findings. The diagram is not the database's physical execution plan.

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

Query Health reports high-confidence query structure and DDL-based estimates. It never claims to be an actual `EXPLAIN`; confirm performance changes with the target database and production-like data.

Each finding declares its category, confidence, and evidence source. See
[QUERY_HEALTH_CAPABILITIES.md](QUERY_HEALTH_CAPABILITIES.md) for implemented
coverage and the explicit boundary between browser-local analysis and concerns
that require a live database or application context.

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
