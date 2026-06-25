import { buildMysqlFlow } from "#/lib/ast/mysql";
import { buildPostgresFlow } from "#/lib/ast/postgres";
import { type Dialect, friendlyError, sanitize } from "#/lib/dialect";
import type { FlowResult } from "#/lib/pipeline";
import type { SchemaModel } from "#/lib/schema/schema";

export interface ParseResult extends FlowResult {
	error?: string;
}

const EMPTY: ParseResult = { nodes: [], edges: [] };

/**
 * Single parsing entry point for the UI. Sanitizes input, routes to the dialect
 * adapter, and converts any thrown parser error into a friendly, dialect-aware
 * message instead of leaking the raw exception. When a schema is supplied, the
 * adapters annotate table nodes with estimated access paths.
 */
export function parseSql(
	raw: string,
	dialect: Dialect,
	schema?: SchemaModel,
): ParseResult {
	const input = sanitize(raw);
	if (!input) return EMPTY;
	try {
		const flow =
			dialect === "postgres"
				? buildPostgresFlow(input, schema)
				: buildMysqlFlow(input, schema);
		return { nodes: flow.nodes, edges: flow.edges };
	} catch (err) {
		return { ...EMPTY, error: friendlyError(raw, input, err, dialect) };
	}
}
