# QueryGraph

QueryGraph turns PostgreSQL and MySQL statements into a clause-by-clause flow diagram. It runs entirely in the browser: paste SQL, choose a dialect, and inspect how the query is shaped from source tables through joins, filters, projections, grouping, sorting, limits, and writes.

## Features

- PostgreSQL and MySQL parsing modes
- Flow diagrams for SELECT, CTE, INSERT, UPDATE, DELETE, and common clause patterns
- Source-to-node highlighting between the SQL editor and graph
- Optional schema DDL input for index-aware access path hints
- Node detail panels with plain-language explanations
- Local-only parsing with no database connection required

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
- `src/lib/__tests__` contains parser, schema, narration, and integration coverage.
- `e2e` contains Playwright coverage for the browser workflow.

## Deployment

The app is configured for Cloudflare Workers through the Cloudflare Vite plugin and `wrangler.jsonc`.

```bash
pnpm run deploy
```
