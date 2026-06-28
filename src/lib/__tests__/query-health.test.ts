import { describe, expect, it } from "vitest";
import type { Dialect } from "#/lib/dialect";
import { parseSql } from "#/lib/parse";
import {
	analyzeQueryHealth,
	HEALTH_RULE_CATALOG,
} from "#/lib/query-health/analyze";
import { parseSchema } from "#/lib/schema/parse-schema";

function health(sql: string, dialect: Dialect, ddl = "") {
	const schema = ddl ? parseSchema(ddl, dialect).schema : undefined;
	const parsed = parseSql(sql, dialect, schema);
	expect(parsed.error).toBeUndefined();
	return analyzeQueryHealth({ sql, dialect, nodes: parsed.nodes, schema });
}

function ids(sql: string, dialect: Dialect, ddl = "") {
	return health(sql, dialect, ddl).map((item) => item.ruleId);
}

describe.each([
	"postgres",
	"mysql",
] as const)("Query Health (%s)", (dialect) => {
	it("detects SELECT * but not explicit projections", () => {
		expect(ids("SELECT * FROM users", dialect)).toContain("select-star");
		expect(ids("SELECT id FROM users", dialect)).not.toContain("select-star");
	});

	it("detects LIMIT without ORDER BY and accepts deterministic limits", () => {
		expect(ids("SELECT id FROM users LIMIT 5", dialect)).toContain(
			"limit-without-order",
		);
		expect(
			ids("SELECT id FROM users ORDER BY id LIMIT 5", dialect),
		).not.toContain("limit-without-order");
	});

	it("detects explicit CROSS JOIN without flagging a conditioned join", () => {
		expect(ids("SELECT a.id FROM a CROSS JOIN b", dialect)).toContain(
			"cartesian-join",
		);
		expect(
			ids("SELECT a.id FROM a JOIN b ON b.a_id = a.id", dialect),
		).not.toContain("cartesian-join");
	});

	it("detects unbounded UPDATE and DELETE", () => {
		expect(ids("UPDATE users SET active = 0", dialect)).toContain(
			"update-without-where",
		);
		expect(ids("DELETE FROM users", dialect)).toContain("delete-without-where");
		expect(
			ids("UPDATE users SET active = 0 WHERE id = 1", dialect),
		).not.toContain("update-without-where");
		expect(ids("DELETE FROM users WHERE id = 1", dialect)).not.toContain(
			"delete-without-where",
		);
	});

	it("detects leading wildcard LIKE but not an anchored prefix", () => {
		expect(
			ids("SELECT id FROM users WHERE email LIKE '%@example.com'", dialect),
		).toContain("leading-wildcard-like");
		expect(
			ids("SELECT id FROM users WHERE email LIKE 'ada%'", dialect),
		).not.toContain("leading-wildcard-like");
	});

	it("requires DDL evidence for an expression on an indexed column", () => {
		const ddl =
			dialect === "postgres"
				? "CREATE TABLE users (id int, email text); CREATE INDEX users_email_idx ON users (email);"
				: "CREATE TABLE users (id int, email varchar(255), INDEX users_email_idx (email));";
		expect(
			ids(
				"SELECT id FROM users WHERE LOWER(email) = 'ada@example.com'",
				dialect,
				ddl,
			),
		).toContain("indexed-column-expression");
		expect(
			ids(
				"SELECT id FROM users WHERE LOWER(email) = 'ada@example.com'",
				dialect,
			),
		).not.toContain("indexed-column-expression");
	});

	it("detects a right-side LEFT JOIN filter and respects ON filters", () => {
		expect(
			ids(
				"SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE p.active = 1",
				dialect,
			),
		).toContain("left-join-filtered-in-where");
		expect(
			ids(
				"SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id = u.id AND p.active = 1",
				dialect,
			),
		).not.toContain("left-join-filtered-in-where");
		expect(
			ids(
				"SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE p.active IS NULL",
				dialect,
			),
		).not.toContain("left-join-filtered-in-where");
		expect(
			ids(
				"SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE p.active = 1 OR p.active IS NULL",
				dialect,
			),
		).not.toContain("left-join-filtered-in-where");
	});

	it("detects composite prefix mismatch and DDL-estimated full scans", () => {
		const ddl =
			dialect === "postgres"
				? "CREATE TABLE events (id int, tenant_id int, created_at timestamp); CREATE INDEX events_tenant_created_idx ON events (tenant_id, created_at);"
				: "CREATE TABLE events (id int, tenant_id int, created_at datetime, INDEX events_tenant_created_idx (tenant_id, created_at));";
		const result = ids(
			"SELECT id FROM events WHERE created_at >= '2026-01-01'",
			dialect,
			ddl,
		);
		expect(result).toContain("composite-index-prefix");
		expect(result).toContain("estimated-full-scan");
		expect(
			ids(
				"SELECT id FROM events WHERE tenant_id = 7 AND created_at >= '2026-01-01'",
				dialect,
				ddl,
			),
		).not.toContain("composite-index-prefix");
		const joinedDdl =
			dialect === "postgres"
				? `${ddl} CREATE TABLE tenants (id int PRIMARY KEY, created_at timestamp);`
				: `${ddl} CREATE TABLE tenants (id int PRIMARY KEY, created_at datetime);`;
		expect(
			ids(
				"SELECT e.id FROM events e JOIN tenants t ON t.id = e.tenant_id WHERE t.created_at >= '2026-01-01'",
				dialect,
				joinedDdl,
			),
		).not.toContain("composite-index-prefix");
	});

	it("returns no findings for malformed SQL", () => {
		expect(
			analyzeQueryHealth({
				sql: "SELCT nope",
				dialect,
				nodes: [],
			}),
		).toEqual([]);
	});

	it("detects invalid NULL comparisons and NULL inside NOT IN", () => {
		expect(ids("SELECT id FROM users WHERE email = NULL", dialect)).toContain(
			"null-comparison",
		);
		expect(
			ids("SELECT id FROM users WHERE id NOT IN (1, NULL)", dialect),
		).toContain("not-in-with-null");
		expect(
			ids("SELECT id FROM users WHERE email IS NULL", dialect),
		).not.toContain("null-comparison");
	});

	it("detects constant-true write filters without flagging real predicates", () => {
		expect(ids("UPDATE users SET active = 0 WHERE 1 = 1", dialect)).toContain(
			"tautological-write-filter",
		);
		expect(ids("DELETE FROM users WHERE tenant_id = 1", dialect)).not.toContain(
			"tautological-write-filter",
		);
	});

	it("detects OFFSET pagination and random ordering", () => {
		expect(
			ids("SELECT id FROM users ORDER BY id LIMIT 10 OFFSET 100", dialect),
		).toContain("offset-pagination");
		const random = dialect === "postgres" ? "RANDOM()" : "RAND()";
		expect(
			ids(`SELECT id FROM users ORDER BY ${random} LIMIT 10`, dialect),
		).toContain("random-order");
		expect(
			ids("SELECT id FROM users ORDER BY id LIMIT 10", dialect),
		).not.toContain("random-order");
	});

	it("recognizes potentially redundant DISTINCT after GROUP BY", () => {
		expect(
			ids(
				"SELECT DISTINCT customer_id FROM orders GROUP BY customer_id",
				dialect,
			),
		).toContain("redundant-distinct");
		expect(
			ids("SELECT customer_id FROM orders GROUP BY customer_id", dialect),
		).not.toContain("redundant-distinct");
	});

	it("classifies findings by confidence, evidence, and category", () => {
		const result = health("SELECT id FROM users LIMIT 5", dialect).find(
			(item) => item.ruleId === "limit-without-order",
		);
		expect(result).toMatchObject({
			confidence: "definite",
			evidenceKind: "query-structure",
			category: "determinism",
		});
	});

	it("reviews nested query blocks and orders severe findings first", () => {
		const result = health(
			"SELECT id FROM users WHERE id IN (SELECT user_id FROM sessions LIMIT 1)",
			dialect,
		);
		expect(result.map((item) => item.ruleId)).toContain("limit-without-order");
		const mixed = health("DELETE FROM users; SELECT * FROM users", dialect);
		expect(mixed[0]?.severity).toBe("danger");
	});

	it("flags destructive table DDL", () => {
		expect(ids("TRUNCATE TABLE users", dialect)).toContain("destructive-ddl");
		expect(ids("DROP TABLE users", dialect)).toContain("destructive-ddl");
	});

	it("flags positional INSERT values but accepts explicit target columns", () => {
		expect(
			ids("INSERT INTO users VALUES (1, 'ada@example.com')", dialect),
		).toContain("insert-without-columns");
		expect(
			ids(
				"INSERT INTO users (id, email) VALUES (1, 'ada@example.com')",
				dialect,
			),
		).not.toContain("insert-without-columns");
	});

	it("uses DDL nullability for NOT IN subqueries", () => {
		const nullableDdl =
			"CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE bans (user_id int);";
		const notNullDdl =
			"CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE bans (user_id int NOT NULL);";
		const query =
			"SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM bans)";
		expect(ids(query, dialect, nullableDdl)).toContain(
			"nullable-not-in-subquery",
		);
		expect(ids(query, dialect, notNullDdl)).not.toContain(
			"nullable-not-in-subquery",
		);
	});

	it("uses DDL to detect impossible NULL checks and non-unique limit ties", () => {
		const ddl =
			dialect === "postgres"
				? "CREATE TABLE users (id int PRIMARY KEY, created_at timestamp NOT NULL);"
				: "CREATE TABLE users (id int PRIMARY KEY, created_at datetime NOT NULL);";
		const impossible = ids(
			"SELECT id FROM users WHERE created_at IS NULL",
			dialect,
			ddl,
		);
		expect(impossible).toContain("not-null-is-null");
		expect(
			ids("SELECT id FROM users ORDER BY created_at LIMIT 10", dialect, ddl),
		).toContain("limit-order-ties");
		expect(
			ids("SELECT id FROM users ORDER BY id LIMIT 10", dialect, ddl),
		).not.toContain("limit-order-ties");
	});

	it("uses uniqueness constraints to bound join duplication warnings", () => {
		const nonUniqueDdl =
			dialect === "postgres"
				? "CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE profiles (id int PRIMARY KEY, user_id int);"
				: "CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE profiles (id int PRIMARY KEY, user_id int);";
		const uniqueDdl =
			dialect === "postgres"
				? "CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE profiles (id int PRIMARY KEY, user_id int UNIQUE);"
				: "CREATE TABLE users (id int PRIMARY KEY); CREATE TABLE profiles (id int PRIMARY KEY, user_id int UNIQUE);";
		const query =
			"SELECT users.id FROM users JOIN profiles ON profiles.user_id = users.id";
		expect(ids(query, dialect, nonUniqueDdl)).toContain("join-may-duplicate");
		expect(ids(query, dialect, uniqueDdl)).not.toContain("join-may-duplicate");
	});
});

describe("dialect-specific grouping review", () => {
	it("flags MySQL non-grouped projections", () => {
		expect(
			ids(
				"SELECT customer_id, status, COUNT(*) FROM orders GROUP BY customer_id",
				"mysql",
			),
		).toContain("non-grouped-select");
	});

	it("accepts grouped and aggregated MySQL projections", () => {
		expect(
			ids(
				"SELECT customer_id, MAX(status) FROM orders GROUP BY customer_id",
				"mysql",
			),
		).not.toContain("non-grouped-select");
	});

	it("accepts MySQL columns functionally dependent on a grouped key", () => {
		expect(
			ids(
				"SELECT id, email FROM users GROUP BY id",
				"mysql",
				"CREATE TABLE users (id int PRIMARY KEY, email varchar(255));",
			),
		).not.toContain("non-grouped-select");
	});
});

describe("PostgreSQL DISTINCT ON review", () => {
	it("requires deterministic, prefix-compatible ordering", () => {
		expect(
			ids(
				"SELECT DISTINCT ON (account_id) account_id, created_at FROM events",
				"postgres",
			),
		).toContain("distinct-on-order");
		expect(
			ids(
				"SELECT DISTINCT ON (account_id) account_id, created_at FROM events ORDER BY created_at DESC",
				"postgres",
			),
		).toContain("distinct-on-order");
		expect(
			ids(
				"SELECT DISTINCT ON (account_id) account_id, created_at FROM events ORDER BY account_id, created_at DESC",
				"postgres",
			),
		).not.toContain("distinct-on-order");
	});
});

describe("rule catalog", () => {
	it("classifies every stable rule ID", () => {
		expect(Object.keys(HEALTH_RULE_CATALOG)).toHaveLength(24);
		for (const metadata of Object.values(HEALTH_RULE_CATALOG)) {
			expect(metadata.category).toBeTruthy();
			expect(metadata.confidence).toBeTruthy();
			expect(metadata.evidenceKind).toBeTruthy();
		}
	});
});
