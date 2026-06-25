import type { Dialect } from "#/lib/dialect";
import { sanitize } from "#/lib/dialect";
import { extractMysqlSchema } from "#/lib/schema/extract-mysql";
import { extractPostgresSchema } from "#/lib/schema/extract-postgres";
import { emptySchema, type SchemaModel } from "#/lib/schema/schema";

export interface SchemaParseResult {
	schema: SchemaModel;
	error?: string;
}

function schemaErrorText(err: unknown): string {
	const base = err instanceof Error ? err.message : String(err);
	return `Couldn't read the schema DDL: ${base.split("\n")[0]}`;
}

// On a DDL error we still return an empty schema so the query view degrades to
// the logical pipeline rather than blocking on a malformed CREATE statement.
export function parseSchema(raw: string, dialect: Dialect): SchemaParseResult {
	const input = sanitize(raw);
	const schema = emptySchema();
	if (!input) return { schema };
	try {
		if (dialect === "postgres") extractPostgresSchema(schema, input);
		else extractMysqlSchema(schema, input);
		return { schema };
	} catch (err) {
		return { schema: emptySchema(), error: schemaErrorText(err) };
	}
}
