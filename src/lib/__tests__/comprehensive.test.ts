import { describe, expect, it } from "vitest";
import { parseSql } from "#/lib/parse";
import { plainEnglish, detailedContext } from "#/lib/narrate";
import { sanitize } from "#/lib/dialect";
import { lookupClause } from "#/lib/encyclopedia";

function pg(sql: string) {
	return parseSql(sql, "postgres");
}
function my(sql: string) {
	return parseSql(sql, "mysql");
}
function pgKinds(sql: string): string[] {
	const r = pg(sql);
	expect(r.error, `PG parse error for: ${sql}`).toBeUndefined();
	return r.nodes.map((n) => n.data.kind as string);
}
function myKinds(sql: string): string[] {
	const r = my(sql);
	expect(r.error, `MySQL parse error for: ${sql}`).toBeUndefined();
	return r.nodes.map((n) => n.data.kind as string);
}
function pgLabels(sql: string): string[] {
	const r = pg(sql);
	expect(r.error, `PG parse error for: ${sql}`).toBeUndefined();
	return r.nodes.map((n) => n.data.label as string);
}
function myLabels(sql: string): string[] {
	const r = my(sql);
	expect(r.error, `MySQL parse error for: ${sql}`).toBeUndefined();
	return r.nodes.map((n) => n.data.label as string);
}

describe("PostgreSQL SELECT variations", () => {
	it("simple SELECT * FROM table", () => {
		const ks = pgKinds("SELECT * FROM users;");
		expect(ks).toContain("table");
		expect(ks).toContain("select");
	});

	it("SELECT with multiple tables in FROM (implicit cross join)", () => {
		const r = pg("SELECT * FROM a, b;");
		expect(r.error).toBeUndefined();
		expect(r.nodes.length).toBeGreaterThanOrEqual(2);
	});

	it("SELECT with alias", () => {
		const ls = pgLabels("SELECT u.name AS user_name FROM users u;");
		expect(ls.some((l) => l.includes("users"))).toBe(true);
	});

	it("SELECT with schema-qualified table", () => {
		const ls = pgLabels("SELECT * FROM public.users;");
		expect(ls.some((l) => l.includes("users") || l.includes("public"))).toBe(true);
	});

	it("SELECT with multiple WHERE conditions (AND/OR)", () => {
		const ks = pgKinds(
			"SELECT * FROM t WHERE a > 1 AND b < 2 OR c = 3;",
		);
		expect(ks).toContain("where");
	});

	it("SELECT with IN subquery", () => {
		const r = pg(
			"SELECT * FROM t WHERE id IN (SELECT id FROM other WHERE active = true);",
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "where")).toBe(true);
	});

	it("SELECT with EXISTS subquery", () => {
		const r = pg(
			"SELECT * FROM t WHERE EXISTS (SELECT 1 FROM other WHERE other.id = t.id);",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with BETWEEN", () => {
		const r = pg("SELECT * FROM t WHERE val BETWEEN 1 AND 10;");
		expect(r.error).toBeUndefined();
		const where = r.nodes.find((n) => n.data.kind === "where");
		expect(where?.data.label).toContain("BETWEEN");
	});

	it("SELECT with LIKE", () => {
		const r = pg("SELECT * FROM t WHERE name LIKE '%test%';");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with IS NULL / IS NOT NULL", () => {
		const r = pg("SELECT * FROM t WHERE col IS NULL AND other IS NOT NULL;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with COALESCE", () => {
		const r = pg("SELECT COALESCE(name, 'unknown') FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with CASE expression", () => {
		const r = pg(
			"SELECT CASE WHEN status = 1 THEN 'active' ELSE 'inactive' END FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with CAST", () => {
		const r = pg("SELECT CAST(id AS TEXT) FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with aggregate functions", () => {
		const r = pg(
			"SELECT COUNT(*), SUM(amount), AVG(price), MIN(val), MAX(val) FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with HAVING but no GROUP BY fails (parser limitation)", () => {
		// pgsql-ast-parser doesn't support HAVING without GROUP BY (valid PG SQL)
		const r = pg("SELECT COUNT(*) FROM t HAVING COUNT(*) > 1;");
		expect(r.error).toBeDefined();
	});

	it("SELECT with multiple ORDER BY columns", () => {
		const ks = pgKinds(
			"SELECT * FROM t ORDER BY a ASC, b DESC, c;",
		);
		expect(ks).toContain("orderby");
	});

	it("SELECT with LIMIT and OFFSET", () => {
		const r = pg("SELECT * FROM t LIMIT 10 OFFSET 5;");
		expect(r.error).toBeUndefined();
		const limit = r.nodes.find((n) => n.data.kind === "limit");
		expect(limit?.data.label).toContain("10");
	});

	it("SELECT with LIMIT ALL fails (parser limitation)", () => {
		// pgsql-ast-parser doesn't support LIMIT ALL (valid PG SQL)
		const r = pg("SELECT * FROM t LIMIT ALL;");
		expect(r.error).toBeDefined();
	});

	it("SELECT with parameterized query ($1)", () => {
		const r = pg("SELECT * FROM t WHERE id = $1;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with string concatenation ||", () => {
		const r = pg("SELECT first_name || ' ' || last_name FROM users;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with type cast :: operator", () => {
		const r = pg("SELECT id::text FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with array literal", () => {
		const r = pg("SELECT ARRAY[1, 2, 3];");
		expect(r.error).toBeUndefined();
	});
});

describe("PostgreSQL JOIN variations", () => {
	it("INNER JOIN", () => {
		const ks = pgKinds(
			"SELECT * FROM a INNER JOIN b ON a.id = b.a_id;",
		);
		expect(ks).toContain("join");
	});

	it("LEFT JOIN", () => {
		const r = pg("SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;");
		expect(r.error).toBeUndefined();
		const join = r.nodes.find((n) => n.data.kind === "join");
		expect(join?.data.label).toContain("LEFT");
	});

	it("RIGHT JOIN", () => {
		const r = pg("SELECT * FROM a RIGHT JOIN b ON a.id = b.a_id;");
		expect(r.error).toBeUndefined();
		const join = r.nodes.find((n) => n.data.kind === "join");
		expect(join?.data.label).toContain("RIGHT");
	});

	it("FULL OUTER JOIN", () => {
		const r = pg(
			"SELECT * FROM a FULL OUTER JOIN b ON a.id = b.a_id;",
		);
		expect(r.error).toBeUndefined();
		const join = r.nodes.find((n) => n.data.kind === "join");
		expect(join?.data.label).toContain("FULL");
	});

	it("CROSS JOIN", () => {
		const r = pg("SELECT * FROM a CROSS JOIN b;");
		expect(r.error).toBeUndefined();
		const join = r.nodes.find((n) => n.data.kind === "join");
		expect(join?.data.label).toContain("CROSS");
	});

	it("multiple JOINs", () => {
		const ks = pgKinds(
			"SELECT * FROM a JOIN b ON a.id = b.a_id JOIN c ON b.id = c.b_id;",
		);
		expect(ks.filter((k) => k === "join").length).toBe(2);
	});

	it("JOIN with USING clause", () => {
		const r = pg("SELECT * FROM a JOIN b USING (id);");
		expect(r.error).toBeUndefined();
	});

	it("self JOIN", () => {
		const r = pg(
			"SELECT e.name, m.name FROM employees e JOIN employees m ON e.manager_id = m.id;",
		);
		expect(r.error).toBeUndefined();
	});

	it("NATURAL JOIN is rejected with hint", () => {
		const r = pg("SELECT * FROM a NATURAL JOIN b;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/NATURAL JOIN/i);
	});
});

describe("PostgreSQL CTE", () => {
	it("simple CTE", () => {
		const ks = pgKinds(
			"WITH active AS (SELECT * FROM users WHERE active = true) SELECT * FROM active;",
		);
		expect(ks).toContain("cte");
	});

	it("multiple CTEs", () => {
		const r = pg(
			`WITH cte1 AS (SELECT id FROM a), cte2 AS (SELECT id FROM b) SELECT * FROM cte1 JOIN cte2 ON cte1.id = cte2.id;`,
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.filter((n) => n.data.kind === "cte").length).toBe(2);
	});

	it("CTE referenced in WHERE subquery", () => {
		const r = pg(
			`WITH ids AS (SELECT id FROM a) SELECT * FROM b WHERE b.id IN (SELECT id FROM ids);`,
		);
		expect(r.error).toBeUndefined();
	});

	it("recursive CTE with self-referencing edge", () => {
		const r = pg(
			`WITH RECURSIVE tree AS (
				SELECT id, parent_id, name, 1 AS depth FROM categories WHERE parent_id IS NULL
				UNION ALL
				SELECT c.id, c.parent_id, c.name, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id
			) SELECT * FROM tree;`,
		);
		expect(r.error).toBeUndefined();
		expect(r.edges.some((e) => e.type === "recursive")).toBe(true);
	});

	it("recursive CTE generating a series", () => {
		const r = pg(
			`WITH RECURSIVE nums AS (
				SELECT 1 AS n
				UNION ALL
				SELECT n + 1 FROM nums WHERE n < 100
			) SELECT * FROM nums;`,
		);
		expect(r.error).toBeUndefined();
		const cte = r.nodes.find((n) => n.data.kind === "cte");
		// Recursion is detected structurally (the UNION arm references the CTE
		// itself) since stripRecursive blanks the keyword before parsing.
		expect(cte?.data.label).toBe("RECURSIVE: nums");
	});
});

describe("PostgreSQL set operations", () => {
	it("UNION", () => {
		const ks = pgKinds("SELECT a FROM t1 UNION SELECT a FROM t2;");
		expect(ks).toContain("union");
	});

	it("UNION ALL", () => {
		const r = pg("SELECT a FROM t1 UNION ALL SELECT a FROM t2;");
		expect(r.error).toBeUndefined();
		const union = r.nodes.find((n) => n.data.kind === "union");
		expect(union?.data.label).toBe("UNION ALL");
	});

	it("UNION of three queries", () => {
		const r = pg(
			"SELECT a FROM t1 UNION SELECT a FROM t2 UNION SELECT a FROM t3;",
		);
		expect(r.error).toBeUndefined();
	});

	it("INTERSECT fails (parser limitation)", () => {
		// pgsql-ast-parser doesn't support INTERSECT
		const r = pg("SELECT a FROM t1 INTERSECT SELECT a FROM t2;");
		expect(r.error).toBeDefined();
	});

	it("EXCEPT fails (parser limitation)", () => {
		// pgsql-ast-parser doesn't support EXCEPT
		const r = pg("SELECT a FROM t1 EXCEPT SELECT a FROM t2;");
		expect(r.error).toBeDefined();
	});
});

describe("PostgreSQL DML", () => {
	it("INSERT with VALUES", () => {
		const ks = pgKinds("INSERT INTO t (a, b) VALUES (1, 'hello');");
		expect(ks).toContain("insert");
		expect(ks).toContain("values");
	});

	it("INSERT with SELECT", () => {
		const r = pg(
			"INSERT INTO archive (id, name) SELECT id, name FROM users WHERE archived = true;",
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "insert")).toBe(true);
	});

	it("INSERT with multiple value rows", () => {
		const r = pg(
			"INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5, 6);",
		);
		expect(r.error).toBeUndefined();
	});

	it("INSERT ... ON CONFLICT DO NOTHING", () => {
		const ks = pgKinds(
			"INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO NOTHING;",
		);
		expect(ks).toContain("on_conflict");
	});

	it("INSERT ... ON CONFLICT DO UPDATE", () => {
		const ks = pgKinds(
			"INSERT INTO t (id, val) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET val = EXCLUDED.val;",
		);
		expect(ks).toContain("on_conflict");
	});

	it("INSERT ... RETURNING *", () => {
		const r = pg("INSERT INTO t (a) VALUES (1) RETURNING *;");
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "returning")).toBe(true);
	});

	it("UPDATE with SET and WHERE", () => {
		const ks = pgKinds(
			"UPDATE users SET name = 'John' WHERE id = 1;",
		);
		expect(ks).toContain("update");
		expect(ks).toContain("set");
		expect(ks).toContain("where");
	});

	it("UPDATE with multiple SET columns", () => {
		const r = pg(
			"UPDATE t SET a = 1, b = 2, c = 3 WHERE id = 1;",
		);
		expect(r.error).toBeUndefined();
	});

	it("UPDATE ... RETURNING", () => {
		const ks = pgKinds(
			"UPDATE t SET a = 1 WHERE id = 1 RETURNING *;",
		);
		expect(ks).toContain("returning");
	});

	it("DELETE with WHERE", () => {
		const ks = pgKinds("DELETE FROM users WHERE id = 1;");
		expect(ks).toContain("delete");
		expect(ks).toContain("where");
	});

	it("DELETE ... RETURNING", () => {
		const ks = pgKinds("DELETE FROM t WHERE id = 1 RETURNING id;");
		expect(ks).toContain("returning");
	});

	it("DELETE without WHERE (full table delete)", () => {
		const r = pg("DELETE FROM users;");
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "delete")).toBe(true);
	});
});

describe("PostgreSQL CREATE TABLE", () => {
	it("basic CREATE TABLE", () => {
		const ks = pgKinds(
			"CREATE TABLE users (id INTEGER, name VARCHAR(100));",
		);
		expect(ks).toContain("create");
		expect(ks).toContain("column");
	});

	it("CREATE TABLE with constraints", () => {
		const r = pg(
			"CREATE TABLE t (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW());",
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "create")).toBe(true);
	});

	it("CREATE TABLE with multiple columns", () => {
		const r = pg(
			`CREATE TABLE orders (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL,
				total NUMERIC(10,2),
				status TEXT DEFAULT 'pending',
				created_at TIMESTAMP DEFAULT NOW()
			);`,
		);
		expect(r.error).toBeUndefined();
		const cols = r.nodes.filter((n) => n.data.kind === "column");
		expect(cols.length).toBe(5);
	});
});

describe("PostgreSQL subqueries", () => {
	it("subquery in FROM clause", () => {
		const r = pg(
			"SELECT * FROM (SELECT id, name FROM users WHERE active = true) AS active_users;",
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => String(n.data.label).includes("subquery"))).toBe(true);
	});

	it("correlated subquery in WHERE", () => {
		const r = pg(
			"SELECT * FROM orders o WHERE o.total > (SELECT AVG(total) FROM orders WHERE user_id = o.user_id);",
		);
		expect(r.error).toBeUndefined();
	});

	it("scalar subquery in SELECT", () => {
		const r = pg(
			"SELECT name, (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id) AS order_count FROM users;",
		);
		expect(r.error).toBeUndefined();
	});
});

describe("PostgreSQL DISTINCT", () => {
	it("DISTINCT", () => {
		const r = pg("SELECT DISTINCT name FROM users;");
		expect(r.error).toBeUndefined();
	});

	it("DISTINCT ON", () => {
		const ks = pgKinds(
			"SELECT DISTINCT ON (department) * FROM employees ORDER BY department, salary DESC;",
		);
		expect(ks).toContain("distinct_on");
	});
});

describe("PostgreSQL error handling", () => {
	it("empty input returns empty result", () => {
		const r = pg("");
		expect(r.nodes).toEqual([]);
		expect(r.edges).toEqual([]);
	});

	it("whitespace-only input returns empty result", () => {
		const r = pg("   \n\t  ");
		expect(r.nodes).toEqual([]);
		expect(r.edges).toEqual([]);
	});

	it("invalid SQL returns an error", () => {
		const r = pg("SELCT * FORM users;");
		expect(r.error).toBeDefined();
	});

	it("GRANT statement returns a hint", () => {
		const r = pg("GRANT SELECT ON users TO public;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Permission/i);
	});

	it("REVOKE statement returns a hint", () => {
		const r = pg("REVOKE SELECT ON users FROM public;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Permission/i);
	});

	it("CREATE ROLE returns a hint", () => {
		const r = pg("CREATE ROLE admin;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Role/i);
	});

	it("DROP USER returns a hint", () => {
		const r = pg("DROP USER admin;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Role/i);
	});

	it("EXPLAIN returns a hint", () => {
		const r = pg("EXPLAIN SELECT * FROM t;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/EXPLAIN/i);
	});

	it("explicit CTE column list returns a hint", () => {
		const r = pg(
			"WITH cte (a, b) AS (SELECT 1, 2) SELECT * FROM cte;",
		);
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/CTE column/i);
	});

	it("error message is truncated for very long errors", () => {
		const r = pg(`SELCT ${"x".repeat(200)} FORM t;`);
		expect(r.error).toBeDefined();
		expect(r.error?.length).toBeLessThanOrEqual(131);
	});
});

describe("MySQL SELECT variations", () => {
	it("simple SELECT * FROM table", () => {
		const ks = myKinds("SELECT * FROM users;");
		expect(ks).toContain("table");
		expect(ks).toContain("select");
	});

	it("SELECT with backtick-quoted identifiers", () => {
		const ls = myLabels(
			"SELECT `u`.`name` FROM `users` `u` WHERE `u`.`id` > 1;",
		);
		const joined = ls.join(" | ");
		expect(joined).not.toContain("`");
		expect(joined).toContain("users");
	});

	it("SELECT with multiple WHERE conditions", () => {
		const r = my(
			"SELECT * FROM t WHERE a > 1 AND b < 2 OR c = 3;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with IN subquery", () => {
		const r = my(
			"SELECT * FROM t WHERE id IN (SELECT id FROM other WHERE active = 1);",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with BETWEEN", () => {
		const r = my("SELECT * FROM t WHERE val BETWEEN 1 AND 10;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with LIKE", () => {
		const r = my("SELECT * FROM t WHERE name LIKE '%test%';");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with IS NULL / IS NOT NULL", () => {
		const r = my(
			"SELECT * FROM t WHERE col IS NULL AND other IS NOT NULL;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with COALESCE", () => {
		const r = my("SELECT COALESCE(name, 'unknown') FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with CASE expression", () => {
		const r = my(
			"SELECT CASE WHEN status = 1 THEN 'active' ELSE 'inactive' END FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with CAST", () => {
		const r = my("SELECT CAST(id AS CHAR) FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with aggregate functions", () => {
		const r = my(
			"SELECT COUNT(*), SUM(amount), AVG(price), MIN(val), MAX(val) FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SELECT with GROUP BY and HAVING", () => {
		const ks = myKinds(
			"SELECT dept, COUNT(*) FROM emp GROUP BY dept HAVING COUNT(*) > 5;",
		);
		expect(ks).toContain("groupby");
		expect(ks).toContain("having");
	});

	it("SELECT with multiple ORDER BY", () => {
		const ks = myKinds(
			"SELECT * FROM t ORDER BY a ASC, b DESC, c;",
		);
		expect(ks).toContain("orderby");
	});

	it("SELECT with LIMIT offset,count", () => {
		const ls = myLabels("SELECT * FROM t LIMIT 5, 10;");
		const limit = ls.find((l) => l.startsWith("LIMIT"));
		expect(limit).toBe("LIMIT 10 OFFSET 5");
	});

	it("SELECT with LIMIT only", () => {
		const r = my("SELECT * FROM t LIMIT 10;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with DISTINCT", () => {
		const ks = myKinds("SELECT DISTINCT name FROM users;");
		expect(ks).toContain("distinct_on");
	});

	it("SELECT with IF function", () => {
		const r = my("SELECT IF(active = 1, 'yes', 'no') FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with IFNULL", () => {
		const r = my("SELECT IFNULL(name, 'unknown') FROM t;");
		expect(r.error).toBeUndefined();
	});

	it("SELECT with INTERVAL", () => {
		const r = my(
			"SELECT * FROM t WHERE created_at > NOW() - INTERVAL 7 DAY;",
		);
		expect(r.error).toBeUndefined();
	});
});

describe("MySQL JOIN variations", () => {
	it("INNER JOIN", () => {
		const ks = myKinds(
			"SELECT * FROM a INNER JOIN b ON a.id = b.a_id;",
		);
		expect(ks).toContain("join");
	});

	it("LEFT JOIN", () => {
		const r = my("SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;");
		expect(r.error).toBeUndefined();
		const join = r.nodes.find((n) => n.data.kind === "join");
		expect(join?.data.label).toContain("LEFT");
	});

	it("RIGHT JOIN", () => {
		const r = my("SELECT * FROM a RIGHT JOIN b ON a.id = b.a_id;");
		expect(r.error).toBeUndefined();
	});

	it("CROSS JOIN", () => {
		const r = my("SELECT * FROM a CROSS JOIN b;");
		expect(r.error).toBeUndefined();
	});

	it("STRAIGHT_JOIN", () => {
		const ks = myKinds(
			"SELECT * FROM t1 STRAIGHT_JOIN t2 ON t1.id = t2.id;",
		);
		expect(ks).toContain("straight_join");
	});

	it("multiple JOINs", () => {
		const ks = myKinds(
			"SELECT * FROM a JOIN b ON a.id = b.a_id JOIN c ON b.id = c.b_id;",
		);
		expect(ks.filter((k) => k === "join").length).toBe(2);
	});

	it("FULL OUTER JOIN is rejected", () => {
		const r = my("SELECT * FROM a FULL OUTER JOIN b ON a.id = b.id;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/FULL OUTER JOIN/i);
	});

	it("FULL JOIN is rejected", () => {
		const r = my("SELECT * FROM a FULL JOIN b ON a.id = b.id;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/FULL/i);
	});

	it("self JOIN", () => {
		const r = my(
			"SELECT e.name, m.name FROM employees e JOIN employees m ON e.manager_id = m.id;",
		);
		expect(r.error).toBeUndefined();
	});
});

describe("MySQL CTE", () => {
	it("simple CTE", () => {
		const ks = myKinds(
			"WITH active AS (SELECT * FROM users WHERE active = 1) SELECT * FROM active;",
		);
		expect(ks).toContain("cte");
	});

	it("multiple CTEs", () => {
		const r = my(
			`WITH cte1 AS (SELECT id FROM a), cte2 AS (SELECT id FROM b) SELECT * FROM cte1 JOIN cte2 ON cte1.id = cte2.id;`,
		);
		expect(r.error).toBeUndefined();
		expect(r.nodes.filter((n) => n.data.kind === "cte").length).toBe(2);
	});

	it("recursive CTE", () => {
		const r = my(
			`WITH RECURSIVE nums AS (
				SELECT 1 AS n
				UNION ALL
				SELECT n + 1 FROM nums WHERE n < 10
			) SELECT * FROM nums;`,
		);
		expect(r.error).toBeUndefined();
		expect(r.edges.some((e) => e.type === "recursive")).toBe(true);
	});
});

describe("MySQL DML", () => {
	it("INSERT with VALUES", () => {
		const ks = myKinds("INSERT INTO t (a, b) VALUES (1, 'hello');");
		expect(ks).toContain("insert");
		expect(ks).toContain("values");
	});

	it("INSERT IGNORE", () => {
		const ks = myKinds("INSERT IGNORE INTO t (a) VALUES (1);");
		expect(ks).toContain("insert_ignore");
	});

	it("REPLACE INTO", () => {
		const ks = myKinds("REPLACE INTO t (a, b) VALUES (1, 2);");
		expect(ks).toContain("replace");
	});

	it("INSERT ... ON DUPLICATE KEY UPDATE", () => {
		const ks = myKinds(
			"INSERT INTO t (a, b) VALUES (1, 2) ON DUPLICATE KEY UPDATE b = b + 1;",
		);
		expect(ks).toContain("on_duplicate_key");
	});

	it("INSERT with SELECT", () => {
		const r = my(
			"INSERT INTO archive (id, name) SELECT id, name FROM users WHERE archived = 1;",
		);
		expect(r.error).toBeUndefined();
	});

	it("UPDATE with SET and WHERE", () => {
		const ks = myKinds(
			"UPDATE users SET name = 'John' WHERE id = 1;",
		);
		expect(ks).toContain("update");
		expect(ks).toContain("set");
		expect(ks).toContain("where");
	});

	it("multi-table UPDATE", () => {
		const ks = myKinds(
			"UPDATE t1 JOIN t2 ON t1.id = t2.id SET t1.x = t2.y WHERE t1.id > 5;",
		);
		expect(ks).toContain("multi_table_update");
		expect(ks).toContain("set");
	});

	it("DELETE with WHERE classifies as single-table delete", () => {
		const r = my("DELETE FROM users WHERE id = 1;");
		expect(r.error).toBeUndefined();
		// Single-table DELETE should emit a `delete` node (not `multi_table_delete`).
		expect(r.nodes.some((n) => n.data.kind === "delete")).toBe(true);
		expect(r.nodes.some((n) => n.data.kind === "multi_table_delete")).toBe(
			false,
		);
		expect(r.nodes.some((n) => n.data.kind === "where")).toBe(true);
	});

	it("multi-table DELETE", () => {
		const ks = myKinds(
			"DELETE t1, t2 FROM t1 INNER JOIN t2 ON t1.id = t2.id WHERE t1.id < 3;",
		);
		expect(ks).toContain("multi_table_delete");
	});

	it("DELETE without WHERE", () => {
		const r = my("DELETE FROM users;");
		expect(r.error).toBeUndefined();
	});
});

describe("MySQL CREATE TABLE", () => {
	it("basic CREATE TABLE", () => {
		const ks = myKinds(
			"CREATE TABLE users (id INT, name VARCHAR(100));",
		);
		expect(ks).toContain("create");
		expect(ks).toContain("column");
	});

	it("CREATE TABLE with AUTO_INCREMENT", () => {
		const r = my(
			"CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
		);
		expect(r.error).toBeUndefined();
		const idCol = r.nodes.find(
			(n) =>
				n.data.kind === "column" &&
				String(n.data.label).startsWith("id"),
		);
		expect(idCol?.data.label).toContain("AUTO_INCREMENT");
	});

	it("CREATE TABLE with multiple columns", () => {
		const r = my(
			`CREATE TABLE orders (
				id INT AUTO_INCREMENT PRIMARY KEY,
				user_id INT NOT NULL,
				total DECIMAL(10,2),
				status VARCHAR(20) DEFAULT 'pending',
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			) ENGINE=InnoDB;`,
		);
		expect(r.error).toBeUndefined();
		const cols = r.nodes.filter((n) => n.data.kind === "column");
		expect(cols.length).toBe(5);
	});
});

describe("MySQL set operations", () => {
	it("UNION", () => {
		const ks = myKinds("SELECT a FROM t1 UNION SELECT a FROM t2;");
		expect(ks).toContain("union");
	});

	it("UNION ALL", () => {
		const r = my("SELECT a FROM t1 UNION ALL SELECT a FROM t2;");
		expect(r.error).toBeUndefined();
	});
});

describe("MySQL error handling", () => {
	it("empty input returns empty result", () => {
		const r = my("");
		expect(r.nodes).toEqual([]);
		expect(r.edges).toEqual([]);
	});

	it("whitespace-only input returns empty result", () => {
		const r = my("   \n\t  ");
		expect(r.nodes).toEqual([]);
		expect(r.edges).toEqual([]);
	});

	it("invalid SQL returns an error", () => {
		const r = my("SELCT * FORM users;");
		expect(r.error).toBeDefined();
	});

	it("GRANT statement returns a hint", () => {
		const r = my("GRANT SELECT ON users TO 'admin';");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Permission/i);
	});

	it("REVOKE statement returns a hint", () => {
		const r = my("REVOKE SELECT ON users FROM 'admin';");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/Permission/i);
	});

	it("EXPLAIN returns a hint", () => {
		const r = my("EXPLAIN SELECT * FROM t;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/EXPLAIN/i);
	});

	it("RETURNING is not available in MySQL", () => {
		const r = my("DELETE FROM t WHERE id = 1 RETURNING id;");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/RETURNING/i);
	});

	it("ON CONFLICT is PostgreSQL-only", () => {
		const r = my(
			"INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO NOTHING;",
		);
		// Should either error or not produce on_conflict nodes
		if (!r.error) {
			expect(r.nodes.some((n) => n.data.kind === "on_conflict")).toBe(false);
		}
	});
});

describe("MySQL window functions", () => {
	it("ROW_NUMBER with OVER", () => {
		const r = my(
			"SELECT id, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM emp;",
		);
		expect(r.error).toBeUndefined();
		const select = r.nodes.find((n) => n.data.kind === "select");
		expect(select?.data.label).toContain("OVER");
	});

	it("RANK with OVER", () => {
		const r = my(
			"SELECT id, RANK() OVER (ORDER BY score DESC) AS rnk FROM students;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SUM with OVER (running total)", () => {
		const r = my(
			"SELECT id, amount, SUM(amount) OVER (ORDER BY created_at) AS running_total FROM orders;",
		);
		expect(r.error).toBeUndefined();
	});

	it("LAG/LEAD", () => {
		const r = my(
			"SELECT id, LAG(amount, 1) OVER (ORDER BY id) AS prev, LEAD(amount, 1) OVER (ORDER BY id) AS nxt FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("NTILE", () => {
		const r = my(
			"SELECT id, NTILE(4) OVER (ORDER BY score) AS quartile FROM students;",
		);
		expect(r.error).toBeUndefined();
	});
});

describe("PostgreSQL window functions", () => {
	it("ROW_NUMBER with OVER", () => {
		const r = pg(
			"SELECT id, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM emp;",
		);
		expect(r.error).toBeUndefined();
	});

	it("RANK with OVER", () => {
		const r = pg(
			"SELECT id, RANK() OVER (ORDER BY score DESC) AS rnk FROM students;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SUM with OVER (running total)", () => {
		const r = pg(
			"SELECT id, amount, SUM(amount) OVER (ORDER BY created_at) AS running_total FROM orders;",
		);
		expect(r.error).toBeUndefined();
	});

	it("LAG/LEAD", () => {
		const r = pg(
			"SELECT id, LAG(amount, 1) OVER (ORDER BY id) AS prev FROM t;",
		);
		expect(r.error).toBeUndefined();
	});

	it("NTILE", () => {
		const r = pg(
			"SELECT id, NTILE(4) OVER (ORDER BY score) AS quartile FROM students;",
		);
		expect(r.error).toBeUndefined();
	});

	it("window function with named WINDOW fails (parser limitation)", () => {
		// pgsql-ast-parser doesn't support the WINDOW clause
		const r = pg(
			"SELECT id, SUM(amount) OVER w AS total FROM t WINDOW w AS (PARTITION BY user_id ORDER BY created_at);",
		);
		expect(r.error).toBeDefined();
	});
});

describe("edge cases", () => {
	it("semicolon-only input returns empty", () => {
		const r = pg(";");
		expect(r.nodes).toEqual([]);
	});

	it("SQL with comments", () => {
		const r = pg(
			"SELECT * FROM users -- this is a comment\nWHERE id = 1;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SQL with block comments", () => {
		const r = pg(
			"SELECT * /* comment */ FROM users WHERE id = 1;",
		);
		expect(r.error).toBeUndefined();
	});

	it("SQL with smart quotes is sanitized", () => {
		const input = "\u2018hello\u2019";
		const sanitized = sanitize(input);
		expect(sanitized).toBe("'hello'");
	});

	it("SQL with zero-width characters is sanitized", () => {
		const input = "SELECT\u200B*\u200CFROM\u200Dt;";
		const sanitized = sanitize(input);
		// Zero-width chars are removed but surrounding text is preserved
		expect(sanitized).toBe("SELECT*FROMt;");
	});

	it("SQL with BOM is sanitized", () => {
		const input = "\uFEFFSELECT * FROM t;";
		const sanitized = sanitize(input);
		expect(sanitized).toBe("SELECT * FROM t;");
	});

	it("SQL with em-dash is sanitized", () => {
		const input = "SELECT * FROM t\u2014test;";
		const sanitized = sanitize(input);
		expect(sanitized).toBe("SELECT * FROM t--test;");
	});

	it("SQL with CRLF line endings is sanitized", () => {
		const input = "SELECT *\r\nFROM t;";
		const sanitized = sanitize(input);
		expect(sanitized).toBe("SELECT *\nFROM t;");
	});

	it("very long query with many JOINs", () => {
		let sql = "SELECT * FROM t0";
		for (let i = 1; i <= 10; i++) {
			sql += ` JOIN t${i} ON t${i - 1}.id = t${i}.t${i - 1}_id`;
		}
		sql += ";";
		const r = pg(sql);
		expect(r.error).toBeUndefined();
		expect(r.nodes.filter((n) => n.data.kind === "join").length).toBe(10);
	});

	it("very long query with many WHERE conditions", () => {
		let sql = "SELECT * FROM t WHERE ";
		const conditions = [];
		for (let i = 0; i < 20; i++) {
			conditions.push(`col${i} > ${i}`);
		}
		sql += `${conditions.join(" AND ")};`;
		const r = pg(sql);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "where")).toBe(true);
	});

	it("query with Unicode identifiers (PG)", () => {
		const r = pg('SELECT * FROM "users";');
		expect(r.error).toBeUndefined();
	});

	it("empty parentheses in SQL", () => {
		const r = pg("SELECT ();");
		// May or may not error; just ensure no crash
		expect(r).toBeDefined();
	});

	it("deeply nested subquery (3 levels)", () => {
		const r = pg(
			"SELECT * FROM (SELECT * FROM (SELECT * FROM users) AS level1) AS level2;",
		);
		expect(r.error).toBeUndefined();
	});

	it("query with no columns in SELECT", () => {
		// SELECT without FROM
		const r = pg("SELECT 1 + 1;");
		expect(r.error).toBeUndefined();
	});

	it("INSERT with empty VALUES", () => {
		const r = pg("INSERT INTO t DEFAULT VALUES;");
		// May or may not be supported; just ensure no crash
		expect(r).toBeDefined();
	});
});

describe("narration - plainEnglish", () => {
	it("table kind narrates correctly", () => {
		expect(plainEnglish("table", "users", "postgres")).toContain("users");
	});

	it("(no source) narrates correctly", () => {
		expect(plainEnglish("table", "(no source)", "postgres")).toContain(
			"without reading",
		);
	});

	it("subquery narrates correctly", () => {
		expect(plainEnglish("table", "subquery (alias)", "postgres")).toContain(
			"subquery",
		);
	});

	it("where narrates the condition", () => {
		const text = plainEnglish("where", "WHERE id > 5", "postgres");
		expect(text).toContain("id > 5");
		expect(text).not.toContain("WHERE");
	});

	it("having narrates the condition", () => {
		const text = plainEnglish("having", "HAVING COUNT(*) > 1", "postgres");
		expect(text).toContain("COUNT(*) > 1");
	});

	it("join narrates the join type", () => {
		const text = plainEnglish(
			"join",
			"LEFT JOIN ON a.id = b.a_id",
			"postgres",
		);
		expect(text).toContain("JOIN");
	});

	it("CROSS JOIN narrates correctly", () => {
		const text = plainEnglish(
			"join",
			"CROSS JOIN",
			"postgres",
		);
		expect(text).toContain("every row");
	});

	it("NATURAL JOIN narrates correctly", () => {
		const text = plainEnglish(
			"join",
			"NATURAL JOIN",
			"postgres",
		);
		expect(text).toContain("identically-named");
	});

	it("select narrates projection", () => {
		expect(plainEnglish("select", "SELECT id, name", "postgres")).toContain(
			"output columns",
		);
	});

	it("groupby narrates bucketing", () => {
		const text = plainEnglish(
			"groupby",
			"GROUP BY department",
			"postgres",
		);
		expect(text).toContain("department");
	});

	it("orderby narrates sorting", () => {
		const text = plainEnglish(
			"orderby",
			"ORDER BY name ASC",
			"postgres",
		);
		expect(text).toContain("name ASC");
	});

	it("limit narrates row cap", () => {
		const text = plainEnglish("limit", "LIMIT 10", "postgres");
		expect(text).toContain("10");
	});

	it("union narrates correctly", () => {
		expect(plainEnglish("union", "UNION", "postgres")).toContain("dropping duplicates");
		expect(plainEnglish("union", "UNION ALL", "postgres")).toContain(
			"duplicates and all",
		);
	});

	it("insert narrates write", () => {
		expect(plainEnglish("insert", "INSERT INTO t", "postgres")).toContain(
			"Writes",
		);
	});

	it("delete narrates removal", () => {
		const text = plainEnglish(
			"delete",
			"DELETE FROM users",
			"postgres",
		);
		expect(text).toContain("users");
	});

	it("update narrates rewrite", () => {
		const text = plainEnglish(
			"update",
			"UPDATE users",
			"postgres",
		);
		expect(text).toContain("users");
	});

	it("values narrates literal rows", () => {
		expect(plainEnglish("values", "VALUES", "postgres")).toContain(
			"literal",
		);
	});

	it("create narrates table definition", () => {
		const text = plainEnglish(
			"create",
			"CREATE TABLE users",
			"postgres",
		);
		expect(text).toContain("users");
	});

	it("returning narrates echo", () => {
		const text = plainEnglish(
			"returning",
			"RETURNING id",
			"postgres",
		);
		expect(text).toContain("id");
	});

	it("cte narrates correctly (non-recursive)", () => {
		const text = plainEnglish("cte", "CTE: my_cte", "postgres");
		expect(text).toContain("my_cte");
	});

	it("cte narrates correctly (recursive)", () => {
		const text = plainEnglish(
			"cte",
			"RECURSIVE: tree",
			"postgres",
		);
		expect(text).toContain("looping");
	});

	it("on_conflict narrates DO NOTHING", () => {
		const text = plainEnglish(
			"on_conflict",
			"ON CONFLICT (id) DO NOTHING",
			"postgres",
		);
		expect(text).toContain("skips");
	});

	it("on_conflict narrates DO UPDATE", () => {
		const text = plainEnglish(
			"on_conflict",
			"ON CONFLICT (id) DO UPDATE",
			"postgres",
		);
		expect(text).toContain("updates");
	});

	it("on_duplicate_key narrates correctly", () => {
		const text = plainEnglish(
			"on_duplicate_key",
			"ON DUPLICATE KEY UPDATE b = 1",
			"mysql",
		);
		expect(text).toContain("b = 1");
	});

	it("insert_ignore narrates correctly", () => {
		const text = plainEnglish("insert_ignore", "INSERT IGNORE", "mysql");
		expect(text).toContain("silently");
	});

	it("replace narrates correctly", () => {
		const text = plainEnglish("replace", "REPLACE INTO t", "mysql");
		expect(text).toContain("Deletes");
	});

	it("straight_join narrates correctly", () => {
		const text = plainEnglish("straight_join", "STRAIGHT_JOIN", "mysql");
		expect(text).toContain("left table");
	});

	it("set narrates assignments", () => {
		const text = plainEnglish("set", "SET a = 1, b = 2", "postgres");
		expect(text).toContain("a = 1, b = 2");
	});

	it("multi_table_update narrates correctly", () => {
		const text = plainEnglish(
			"multi_table_update",
			"UPDATE t1, t2",
			"mysql",
		);
		expect(text).toContain("t1, t2");
	});

	it("multi_table_delete narrates correctly", () => {
		const text = plainEnglish(
			"multi_table_delete",
			"DELETE t1, t2",
			"mysql",
		);
		expect(text).toContain("t1, t2");
	});

	it("index_hint narrates correctly", () => {
		const text = plainEnglish(
			"index_hint",
			"USE INDEX (idx_name)",
			"mysql",
		);
		expect(text).toContain("USE INDEX");
	});

	it("distinct_on narrates differently per dialect", () => {
		const pg = plainEnglish("distinct_on", "DISTINCT ON (a)", "postgres");
		const my = plainEnglish("distinct_on", "DISTINCT", "mysql");
		expect(pg).toContain("first row");
		expect(my).toContain("duplicate");
	});

	it("unknown kind falls back to generic narration", () => {
		const text = plainEnglish("unknown_kind", "SOMETHING", "postgres");
		expect(text).toContain("SOMETHING");
	});
});

describe("narration - detailedContext", () => {
	it("provides dialect-aware table explanation", () => {
		const pg = detailedContext("table", "users", "postgres");
		const my = detailedContext("table", "users", "mysql");
		expect(pg).toContain("double quotes");
		expect(my).toContain("backticks");
	});

	it("provides dialect-aware WHERE explanation", () => {
		const pg = detailedContext("where", "WHERE name = 'x'", "postgres");
		const my = detailedContext("where", "WHERE name = 'x'", "mysql");
		expect(pg).toContain("case-sensitively");
		expect(my).toContain("case-insensitively");
	});

	it("provides dialect-aware LIMIT explanation", () => {
		const pg = detailedContext("limit", "LIMIT 10", "postgres");
		const my = detailedContext("limit", "LIMIT 10 OFFSET 5", "mysql");
		expect(pg).toContain("OFFSET");
		expect(my).toContain("LIMIT a, b");
	});

	it("provides CROSS JOIN explanation", () => {
		const text = detailedContext(
			"join",
			"CROSS JOIN",
			"postgres",
		);
		expect(text).toContain("Cartesian");
	});

	it("provides INSERT IGNORE explanation", () => {
		const text = detailedContext(
			"insert_ignore",
			"INSERT IGNORE",
			"mysql",
		);
		expect(text).toContain("duplicate-key");
	});

	it("provides REPLACE explanation (not upsert)", () => {
		const text = detailedContext(
			"replace",
			"REPLACE INTO t",
			"mysql",
		);
		expect(text).toContain("not an upsert");
	});

	it("provides ON CONFLICT DO NOTHING explanation", () => {
		const text = detailedContext(
			"on_conflict",
			"ON CONFLICT (id) DO NOTHING",
			"postgres",
		);
		expect(text).toContain("DO NOTHING");
	});

	it("provides ON CONFLICT DO UPDATE explanation", () => {
		const text = detailedContext(
			"on_conflict",
			"ON CONFLICT (id) DO UPDATE",
			"postgres",
		);
		expect(text).toContain("upsert");
	});

	it("provides CREATE TABLE explanation with dialect", () => {
		const pg = detailedContext("create", "CREATE TABLE t", "postgres");
		const my = detailedContext("create", "CREATE TABLE t", "mysql");
		expect(pg).toContain("BOOLEAN");
		expect(my).toContain("TINYINT");
	});

	it("provides RETURNING explanation (PG-only note in mysql)", () => {
		const text = detailedContext(
			"returning",
			"RETURNING id",
			"mysql",
		);
		expect(text).toContain("PostgreSQL");
	});

	it("provides STRAIGHT_JOIN explanation", () => {
		const text = detailedContext(
			"straight_join",
			"STRAIGHT_JOIN",
			"mysql",
		);
		expect(text).toContain("left table");
	});

	it("provides index hint explanation", () => {
		const text = detailedContext(
			"index_hint",
			"USE INDEX (idx)",
			"mysql",
		);
		expect(text).toContain("USE INDEX");
	});

	it("provides multi_table_update explanation", () => {
		const text = detailedContext(
			"multi_table_update",
			"UPDATE t1, t2",
			"mysql",
		);
		expect(text).toContain("multi-table");
	});

	it("provides multi_table_delete explanation", () => {
		const text = detailedContext(
			"multi_table_delete",
			"DELETE t1, t2",
			"mysql",
		);
		expect(text).toContain("multi-table");
	});

	it("provides VALUES explanation", () => {
		const text = detailedContext("values", "VALUES", "postgres");
		expect(text).toContain("literal");
	});

	it("provides column explanation with dialect", () => {
		const pg = detailedContext("column", "id SERIAL", "postgres");
		const my = detailedContext("column", "id INT", "mysql");
		expect(pg).toContain("SERIAL");
		expect(my).toContain("AUTO_INCREMENT");
	});

	it("falls back for unknown kind", () => {
		const text = detailedContext(
			"unknown_kind",
			"SOMETHING",
			"postgres",
		);
		expect(text).toContain("SOMETHING");
	});
});

describe("encyclopedia lookupClause", () => {
	it("returns correct entry for known kinds", () => {
		const entry = lookupClause("where", "postgres");
		expect(entry.heading).toContain("WHERE");
		expect(entry.docs).toContain("postgresql.org");
	});

	it("returns correct entry for MySQL", () => {
		const entry = lookupClause("where", "mysql");
		expect(entry.heading).toContain("WHERE");
		expect(entry.docs).toContain("mysql.com");
	});

	it("falls back to operation for unknown kinds", () => {
		const entry = lookupClause("nonexistent", "postgres");
		expect(entry.heading).toBe("SQL Statement");
	});

	it("has entries for all expected postgres kinds", () => {
		const expected = [
			"table", "insert_target", "join", "where", "having", "select",
			"distinct_on", "groupby", "orderby", "limit", "cte", "union",
			"values", "insert", "on_conflict", "update", "delete", "set",
			"returning", "create", "column",
		];
		for (const kind of expected) {
			const entry = lookupClause(kind, "postgres");
			expect(entry.heading, `missing heading for ${kind}`).toBeTruthy();
			expect(entry.summary, `missing summary for ${kind}`).toBeTruthy();
			expect(entry.docs, `missing docs for ${kind}`).toBeTruthy();
		}
	});

	it("has entries for all expected mysql kinds", () => {
		const expected = [
			"table", "insert_target", "join", "straight_join", "where", "having",
			"select", "distinct_on", "groupby", "orderby", "limit", "index_hint",
			"cte", "union", "values", "insert", "insert_ignore", "replace",
			"on_duplicate_key", "update", "multi_table_update", "delete",
			"multi_table_delete", "set", "create", "column",
		];
		for (const kind of expected) {
			const entry = lookupClause(kind, "mysql");
			expect(entry.heading, `missing heading for ${kind}`).toBeTruthy();
			expect(entry.summary, `missing summary for ${kind}`).toBeTruthy();
			expect(entry.docs, `missing docs for ${kind}`).toBeTruthy();
		}
	});
});

describe("pipeline rendering", () => {
	it("produces correct number of nodes", () => {
		const r = pg(
			"SELECT * FROM users WHERE id > 5 ORDER BY name LIMIT 10;",
		);
		// table, where, select, orderby, limit = 5
		expect(r.nodes.length).toBe(5);
	});

	it("produces correct number of edges", () => {
		const r = pg(
			"SELECT * FROM users WHERE id > 5 ORDER BY name LIMIT 10;",
		);
		// 4 edges connecting 5 nodes in a chain
		expect(r.edges.length).toBe(4);
	});

	it("each node has required fields", () => {
		const r = pg("SELECT * FROM users;");
		for (const node of r.nodes) {
			expect(node.id).toBeTruthy();
			expect(node.type).toBe("sql");
			expect(node.position).toBeDefined();
			expect(typeof node.position.x).toBe("number");
			expect(typeof node.position.y).toBe("number");
			expect(node.data).toBeDefined();
			expect(node.data.kind).toBeTruthy();
			expect(node.data.label).toBeTruthy();
			expect(node.data.prose).toBeTruthy();
			expect(typeof node.data.step).toBe("number");
		}
	});

	it("each edge has required fields", () => {
		const r = pg("SELECT * FROM users WHERE id > 5;");
		for (const edge of r.edges) {
			expect(edge.id).toBeTruthy();
			expect(edge.source).toBeTruthy();
			expect(edge.target).toBeTruthy();
			expect(edge.animated).toBe(true);
			expect(edge.markerEnd).toBeDefined();
		}
	});

	it("step numbers are sequential starting from 1", () => {
		const r = pg(
			"SELECT * FROM users WHERE id > 5 ORDER BY name LIMIT 10;",
		);
		const steps = r.nodes.map((n) => n.data.step as number);
		expect(steps).toEqual([1, 2, 3, 4, 5]);
	});

	it("node kind matches expected color mapping", () => {
		const r = pg(
			"SELECT * FROM users WHERE id > 5 GROUP BY dept HAVING COUNT(*) > 1 ORDER BY name LIMIT 10;",
		);
		for (const node of r.nodes) {
			expect(node.style).toBeDefined();
			expect((node.style as Record<string, string>)["--node-hue"]).toBeTruthy();
		}
	});

	it("recursive edges have type 'recursive'", () => {
		const r = pg(
			`WITH RECURSIVE nums AS (
				SELECT 1 AS n
				UNION ALL
				SELECT n + 1 FROM nums WHERE n < 5
			) SELECT * FROM nums;`,
		);
		const recursiveEdges = r.edges.filter((e) => e.type === "recursive");
		expect(recursiveEdges.length).toBeGreaterThanOrEqual(1);
		for (const edge of recursiveEdges) {
			expect(edge.data?.fromX).toBeDefined();
			expect(edge.data?.fromY).toBeDefined();
			expect(edge.data?.toX).toBeDefined();
			expect(edge.data?.toY).toBeDefined();
			expect(edge.data?.loopX).toBeDefined();
		}
	});

	it("empty result for empty input", () => {
		const r = pg("");
		expect(r.nodes).toEqual([]);
		expect(r.edges).toEqual([]);
	});
});

describe("complex real-world PostgreSQL queries", () => {
	it("e-commerce analytics query", () => {
		const r = pg(`
			SELECT
				c.name AS customer,
				COUNT(o.id) AS total_orders,
				SUM(oi.quantity * oi.price) AS total_spent,
				RANK() OVER (ORDER BY SUM(oi.quantity * oi.price) DESC) AS spend_rank
			FROM customers c
			JOIN orders o ON o.customer_id = c.id
			JOIN order_items oi ON oi.order_id = o.id
			WHERE o.created_at >= '2024-01-01'
				AND c.active = true
			GROUP BY c.id, c.name
			HAVING COUNT(o.id) > 3
			ORDER BY total_spent DESC
			LIMIT 50;
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.length).toBeGreaterThanOrEqual(7);
	});

	it("recursive org chart query", () => {
		const r = pg(`
			WITH RECURSIVE org AS (
				SELECT id, name, manager_id, 1 AS depth, ARRAY[id] AS path
				FROM employees
				WHERE manager_id IS NULL
				UNION ALL
				SELECT e.id, e.name, e.manager_id, org.depth + 1, org.path || e.id
				FROM employees e
				JOIN org ON e.manager_id = org.id
				WHERE NOT e.id = ANY(org.path)
			)
			SELECT * FROM org ORDER BY path;
		`);
		expect(r.error).toBeUndefined();
		expect(r.edges.some((e) => e.type === "recursive")).toBe(true);
	});

	it("INSERT with CTE and ON CONFLICT", () => {
		const r = pg(`
			WITH new_data AS (
				SELECT id, name FROM staging
			)
			INSERT INTO users (id, name)
			SELECT id, name FROM new_data
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
			RETURNING id, name;
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "cte")).toBe(true);
		expect(r.nodes.some((n) => n.data.kind === "on_conflict")).toBe(true);
		expect(r.nodes.some((n) => n.data.kind === "returning")).toBe(true);
	});

	it("UPDATE with CTE", () => {
		const r = pg(`
			WITH to_update AS (
				SELECT id FROM users WHERE last_login < '2023-01-01'
			)
			UPDATE users SET active = false
			WHERE id IN (SELECT id FROM to_update)
			RETURNING id;
		`);
		expect(r.error).toBeUndefined();
	});

	it("DELETE with subquery in WHERE", () => {
		const r = pg(`
			DELETE FROM sessions
			WHERE user_id IN (
				SELECT id FROM users WHERE banned = true
			)
			RETURNING session_id;
		`);
		expect(r.error).toBeUndefined();
	});

	it("multiple UNIONs with ORDER BY", () => {
		const r = pg(`
			SELECT name, 'customer' AS type FROM customers
			UNION ALL
			SELECT name, 'employee' AS type FROM employees
			UNION ALL
			SELECT name, 'vendor' AS type FROM vendors
			ORDER BY name;
		`);
		expect(r.error).toBeUndefined();
	});
});

describe("complex real-world MySQL queries", () => {
	it("e-commerce analytics query", () => {
		const r = my(`
			SELECT
				c.name AS customer,
				COUNT(o.id) AS total_orders,
				SUM(oi.quantity * oi.price) AS total_spent
			FROM customers c
			JOIN orders o ON o.customer_id = c.id
			JOIN order_items oi ON oi.order_id = o.id
			WHERE o.created_at >= '2024-01-01'
				AND c.active = 1
			GROUP BY c.id, c.name
			HAVING COUNT(o.id) > 3
			ORDER BY total_spent DESC
			LIMIT 50;
		`);
		expect(r.error).toBeUndefined();
	});

	it("INSERT with ON DUPLICATE KEY UPDATE", () => {
		const r = my(`
			INSERT INTO stats (user_id, login_count, last_login)
			VALUES (1, 1, NOW())
			ON DUPLICATE KEY UPDATE
				login_count = login_count + 1,
				last_login = NOW();
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "on_duplicate_key")).toBe(true);
	});

	it("multi-table UPDATE", () => {
		const r = my(`
			UPDATE products p
			JOIN inventory i ON p.id = i.product_id
			SET p.stock = i.quantity, p.updated_at = NOW()
			WHERE i.warehouse_id = 1;
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "multi_table_update")).toBe(true);
	});

	it("multi-table DELETE", () => {
		const r = my(`
			DELETE o, oi
			FROM orders o
			JOIN order_items oi ON o.id = oi.order_id
			WHERE o.created_at < '2020-01-01';
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "multi_table_delete")).toBe(true);
	});

	it("REPLACE INTO", () => {
		const r = my(`
			REPLACE INTO settings (key_name, value)
			VALUES ('theme', 'dark');
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "replace")).toBe(true);
	});

	it("INSERT IGNORE", () => {
		const r = my(`
			INSERT IGNORE INTO tags (name)
			SELECT DISTINCT tag FROM post_tags;
		`);
		expect(r.error).toBeUndefined();
		expect(r.nodes.some((n) => n.data.kind === "insert_ignore")).toBe(true);
	});

	it("window function with partition", () => {
		const r = my(`
			SELECT
				department,
				name,
				salary,
				ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank_in_dept,
				AVG(salary) OVER (PARTITION BY department) AS dept_avg
			FROM employees;
		`);
		expect(r.error).toBeUndefined();
	});

	it("recursive CTE for hierarchical data", () => {
		const r = my(`
			WITH RECURSIVE category_path AS (
				SELECT id, name, parent_id, CAST(name AS CHAR(200)) AS path
				FROM categories
				WHERE parent_id IS NULL
				UNION ALL
				SELECT c.id, c.name, c.parent_id, CONCAT(cp.path, ' > ', c.name)
				FROM categories c
				JOIN category_path cp ON c.parent_id = cp.id
			)
			SELECT * FROM category_path ORDER BY path;
		`);
		expect(r.error).toBeUndefined();
		expect(r.edges.some((e) => e.type === "recursive")).toBe(true);
	});
});
