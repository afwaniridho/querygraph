import { Parser } from "node-sql-parser";
import { parse as parsePg } from "pgsql-ast-parser";
import { describe, expect, it } from "vitest";
import { analyzeTableAccess, buildFacts } from "#/lib/access-path";
import type { Dialect } from "#/lib/dialect";
import { parseSql } from "#/lib/parse";
import { parseSchema } from "#/lib/schema/parse-schema";

const myParser = new Parser();

function pgFacts(sql: string) {
	const ast = parsePg(sql)[0] as never;
	return buildFacts(ast, "postgres");
}

function myFacts(sql: string) {
	const ast = myParser.astify(sql, { database: "mysql" }) as never;
	const stmt = Array.isArray(ast) ? ast[0] : ast;
	return buildFacts(stmt, "mysql");
}

function analyze(
	ddl: string,
	sql: string,
	table: string,
	alias: string,
	dialect: Dialect,
) {
	const { schema } = parseSchema(ddl, dialect);
	const facts = dialect === "postgres" ? pgFacts(sql) : myFacts(sql);
	return analyzeTableAccess({
		alias,
		tableName: table,
		facts,
		schema,
		dialect,
	});
}

describe("access-path analyzer (postgres)", () => {
	const usersDdl = `CREATE TABLE users (
    id int PRIMARY KEY,
    email varchar(255) UNIQUE,
    org_id int,
    status varchar(20),
    created_at timestamp
  );
  CREATE INDEX idx_org_status ON users (org_id, status);
  CREATE INDEX idx_created ON users (created_at);`;

	it("flags a primary-key lookup", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE id = 5",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("pk_lookup");
	});

	it("flags a unique lookup on a unique column", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE email = 'a@b.com'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("unique_lookup");
	});

	it("uses the leftmost prefix of a composite index", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE org_id = 1",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("index_seek");
		expect(r?.index).toBe("idx_org_status");
	});

	it("uses equality-then-range across a composite index", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE org_id = 1 AND status > 'a'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.index).toBe("idx_org_status");
		expect(["index_seek", "index_range"]).toContain(r?.method);
	});

	it("flags a range scan", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE created_at > '2024-01-01'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.index).toBe("idx_created");
		expect(r?.method).toBe("index_range");
	});

	it("flags a covering index when all touched columns are indexed", () => {
		const r = analyze(
			usersDdl,
			"SELECT org_id, status FROM users WHERE org_id = 1",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("covering");
	});

	it("falls back to a full scan with no usable index", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE status = 'active'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("full_scan");
	});

	it("detects sort satisfied by the index", () => {
		const r = analyze(
			usersDdl,
			"SELECT id FROM users WHERE org_id = 1 ORDER BY status",
			"users",
			"users",
			"postgres",
		);
		expect(r?.index).toBe("idx_org_status");
		expect(r?.sortSatisfied).toBe(true);
	});

	it("treats a function-wrapped column as a full scan", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE lower(email) = 'a'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("full_scan");
		expect(r?.reason).toMatch(/function/i);
	});

	it("treats an OR across columns as a full scan", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE org_id = 1 OR status = 'x'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("full_scan");
	});

	it("treats a leading-wildcard LIKE as a full scan", () => {
		const r = analyze(
			usersDdl,
			"SELECT name FROM users WHERE email LIKE '%z'",
			"users",
			"users",
			"postgres",
		);
		expect(r?.method).toBe("full_scan");
	});

	it("returns undefined for a table not in the schema", () => {
		const r = analyze(
			usersDdl,
			"SELECT * FROM ghosts WHERE id = 1",
			"ghosts",
			"ghosts",
			"postgres",
		);
		expect(r).toBeUndefined();
	});

	it("matches predicates through a table alias", () => {
		const r = analyze(
			usersDdl,
			"SELECT u.name FROM users u WHERE u.id = 5",
			"users",
			"u",
			"postgres",
		);
		expect(r?.method).toBe("pk_lookup");
	});
});

describe("access-path analyzer (mysql)", () => {
	const ddl = `CREATE TABLE users (
    id INT,
    email VARCHAR(255),
    org_id INT,
    status VARCHAR(20),
    PRIMARY KEY (id),
    UNIQUE KEY uq_email (email),
    KEY idx_org_status (org_id, status)
  );`;

	it("flags a primary-key lookup", () => {
		const r = analyze(
			ddl,
			"SELECT email FROM users WHERE id = 1",
			"users",
			"users",
			"mysql",
		);
		expect(r?.method).toBe("pk_lookup");
	});

	it("flags a unique lookup", () => {
		const r = analyze(
			ddl,
			"SELECT id FROM users WHERE email = 'a@b.com'",
			"users",
			"users",
			"mysql",
		);
		expect(r?.method).toBe("unique_lookup");
	});

	it("uses the leftmost prefix of a composite index", () => {
		const r = analyze(
			ddl,
			"SELECT id FROM users WHERE org_id = 2",
			"users",
			"users",
			"mysql",
		);
		expect(r?.index).toBe("idx_org_status");
	});

	it("falls back to a full scan with no usable index", () => {
		const r = analyze(
			ddl,
			"SELECT id FROM users WHERE status = 'active'",
			"users",
			"users",
			"mysql",
		);
		expect(r?.method).toBe("full_scan");
	});
});

describe("access-aware table/source prose", () => {
	const customersDdl =
		"CREATE TABLE customers (id int PRIMARY KEY, first_name varchar(80));";

	function tableNode(sql: string, dialect: Dialect = "postgres") {
		const { schema } = parseSchema(customersDdl, dialect);
		const result = parseSql(sql, dialect, schema);
		const node = result.nodes.find((n) => n.data?.kind === "table");
		if (!node) throw new Error("no table node in flow");
		return node;
	}

	it("does not say 'Reads every row' when the access path is a PK lookup", () => {
		const node = tableNode("SELECT * FROM customers WHERE id = 40;");
		const access = node.data.access as { method: string } | undefined;
		expect(access?.method).toBe("pk_lookup");
		const prose = node.data.prose as string;
		expect(prose).not.toMatch(/Reads every row/i);
		expect(prose).toMatch(/at most one row/i);
		expect(prose).toMatch(/primary key/i);
	});

	it("keeps the WHERE node alongside a PK lookup (residual predicate case)", () => {
		const node = tableNode(
			"SELECT * FROM customers WHERE first_name = 'Hore' AND id = 2;",
		);
		const access = node.data.access as { method: string } | undefined;
		expect(access?.method).toBe("pk_lookup");
		const { schema } = parseSchema(customersDdl, "postgres");
		const flow = parseSql(
			"SELECT * FROM customers WHERE first_name = 'Hore' AND id = 2;",
			"postgres",
			schema,
		);
		const whereNode = flow.nodes.find((n) => n.data?.kind === "where");
		expect(whereNode).toBeDefined();
		expect(whereNode?.data.label as string).toMatch(/first_name/i);
		expect(whereNode?.data.label as string).toMatch(/id/);
	});

	it("keeps the full-scan wording when the predicate hits no index", () => {
		const node = tableNode(
			"SELECT * FROM customers WHERE first_name = 'Hore';",
		);
		const access = node.data.access as { method: string } | undefined;
		expect(access?.method).toBe("full_scan");
		const prose = node.data.prose as string;
		expect(prose).toMatch(/Reads every row/i);
	});

	it("retains schemaless behavior with no schema (no access info, generic prose)", () => {
		const flow = parseSql("SELECT * FROM customers WHERE id = 40;", "postgres");
		const node = flow.nodes.find((n) => n.data?.kind === "table");
		expect(node?.data.access).toBeUndefined();
		expect(node?.data.prose as string).toMatch(/Reads every row/i);
	});
});
