import { describe, expect, it } from "vitest";
import { detailedContext } from "#/lib/narrate";
import { parseSql } from "#/lib/parse";

describe("dialect differences", () => {
	it("accepts ON CONFLICT only in postgres", () => {
		const sql = `INSERT INTO t (id, a) VALUES (1, 2) ON CONFLICT (id) DO NOTHING;`;
		const pg = parseSql(sql, "postgres");
		expect(pg.error).toBeUndefined();
		expect(pg.nodes.some((n) => n.data.kind === "on_conflict")).toBe(true);

		const my = parseSql(sql, "mysql");
		// MySQL has no ON CONFLICT; the parser should not produce that node.
		expect(my.nodes.some((n) => n.data.kind === "on_conflict")).toBe(false);
	});

	it("accepts ON DUPLICATE KEY UPDATE only in mysql", () => {
		const sql = `INSERT INTO t (a) VALUES (1) ON DUPLICATE KEY UPDATE a = a + 1;`;
		const my = parseSql(sql, "mysql");
		expect(my.error).toBeUndefined();
		expect(my.nodes.some((n) => n.data.kind === "on_duplicate_key")).toBe(true);

		const pg = parseSql(sql, "postgres");
		expect(pg.error).toBeDefined();
	});

	it("accepts REPLACE INTO only in mysql", () => {
		const sql = `REPLACE INTO t (a) VALUES (1);`;
		const my = parseSql(sql, "mysql");
		expect(my.error).toBeUndefined();
		expect(my.nodes.some((n) => n.data.kind === "replace")).toBe(true);
	});

	it("accepts RETURNING in postgres but hints against it in mysql", () => {
		const sql = `DELETE FROM t WHERE id = 1 RETURNING id;`;
		const pg = parseSql(sql, "postgres");
		expect(pg.error).toBeUndefined();
		expect(pg.nodes.some((n) => n.data.kind === "returning")).toBe(true);

		const my = parseSql(sql, "mysql");
		expect(my.error).toBeDefined();
		expect(my.error).toMatch(/RETURNING/i);
	});

	it("narrates LIMIT differently per dialect", () => {
		const pg = detailedContext("limit", "LIMIT 10", "postgres");
		const my = detailedContext("limit", "LIMIT 10 OFFSET 5", "mysql");
		expect(pg).not.toEqual(my);
		expect(my).toMatch(/LIMIT a, b/i);
		expect(pg).toMatch(/OFFSET/i);
	});

	it("narrates REPLACE as delete-then-insert, not upsert", () => {
		const text = detailedContext("replace", "REPLACE INTO t", "mysql");
		expect(text).toMatch(/not an upsert/i);
		expect(text).toMatch(/DELETE/);
	});

	it("narrates the GROUP BY ONLY_FULL_GROUP_BY difference", () => {
		const pg = detailedContext("groupby", "GROUP BY a", "postgres");
		const my = detailedContext("groupby", "GROUP BY a", "mysql");
		expect(my).toMatch(/ONLY_FULL_GROUP_BY/);
		expect(pg).not.toEqual(my);
	});

	it("narrates string comparison case sensitivity on WHERE", () => {
		const pg = detailedContext("where", "WHERE name = 'x'", "postgres");
		const my = detailedContext("where", "WHERE name = 'x'", "mysql");
		expect(pg).toMatch(/case-sensitive/i);
		expect(my).toMatch(/case-insensitive/i);
	});
});
