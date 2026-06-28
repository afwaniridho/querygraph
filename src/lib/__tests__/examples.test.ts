import { describe, expect, it } from "vitest";
import { SQL_EXAMPLES } from "#/lib/examples";
import { parseSql } from "#/lib/parse";
import { analyzeQueryHealth } from "#/lib/query-health/analyze";
import { parseSchema } from "#/lib/schema/parse-schema";

describe("SQL example gallery", () => {
	it("has stable, unique, complete metadata", () => {
		expect(SQL_EXAMPLES).toHaveLength(16);
		expect(new Set(SQL_EXAMPLES.map((item) => item.id)).size).toBe(
			SQL_EXAMPLES.length,
		);
		for (const example of SQL_EXAMPLES) {
			expect(example.id).toMatch(/^[a-z0-9-]+$/);
			expect(example.title).toBeTruthy();
			expect(example.objective).toBeTruthy();
			expect(example.sql).toBeTruthy();
		}
	});

	it.each(SQL_EXAMPLES)("$id produces every declared finding", (example) => {
		const schema = example.ddl
			? parseSchema(example.ddl, example.dialect).schema
			: undefined;
		const parsed = parseSql(example.sql, example.dialect, schema);
		expect(parsed.error).toBeUndefined();
		const actual = analyzeQueryHealth({
			sql: example.sql,
			dialect: example.dialect,
			nodes: parsed.nodes,
			schema,
		}).map((item) => item.ruleId);
		expect(actual).toEqual(expect.arrayContaining(example.expectedFindingIds));
	});
});
