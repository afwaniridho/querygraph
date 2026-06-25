import { describe, expect, it } from "vitest";
import { parseSql } from "#/lib/parse";

function kinds(sql: string): string[] {
	const result = parseSql(sql, "postgres");
	expect(result.error).toBeUndefined();
	return result.nodes.map((n) => n.data.kind as string);
}

describe("postgres adapter", () => {
	it("builds the default pipeline", () => {
		const ks = kinds(`SELECT c.name, count(o.id) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.placed_at > '2024-01-01'
GROUP BY c.name
HAVING sum(o.total) > 500
ORDER BY orders DESC
LIMIT 10;`);
		expect(ks).toContain("join");
		expect(ks).toContain("where");
		expect(ks).toContain("groupby");
		expect(ks).toContain("having");
		expect(ks).toContain("select");
		expect(ks).toContain("orderby");
		expect(ks).toContain("limit");
	});

	it("handles a CTE", () => {
		const ks = kinds(
			`WITH recent AS (SELECT * FROM orders WHERE total > 10) SELECT * FROM recent;`,
		);
		expect(ks).toContain("cte");
	});

	it("handles UNION", () => {
		const ks = kinds(`SELECT a FROM t1 UNION SELECT a FROM t2;`);
		expect(ks).toContain("union");
	});

	it("handles INSERT ... RETURNING", () => {
		const ks = kinds(`INSERT INTO t (a) VALUES (1) RETURNING a;`);
		expect(ks).toContain("insert");
		expect(ks).toContain("returning");
	});

	it("handles UPDATE ... RETURNING", () => {
		const ks = kinds(`UPDATE t SET a = 1 WHERE id = 2 RETURNING a;`);
		expect(ks).toContain("update");
		expect(ks).toContain("set");
		expect(ks).toContain("returning");
	});

	it("handles DELETE ... RETURNING", () => {
		const ks = kinds(`DELETE FROM t WHERE id = 2 RETURNING id;`);
		expect(ks).toContain("delete");
		expect(ks).toContain("returning");
	});

	it("handles a recursive CTE with a self-referencing edge", () => {
		const result = parseSql(
			`WITH RECURSIVE nums AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM nums WHERE n < 5
) SELECT * FROM nums;`,
			"postgres",
		);
		expect(result.error).toBeUndefined();
		const ks = result.nodes.map((n) => n.data.kind as string);
		expect(ks).toContain("cte");
		// recursive edge is rendered as a "recursive" typed edge
		expect(result.edges.some((e) => e.type === "recursive")).toBe(true);
	});

	it("emits distinct_on for DISTINCT ON", () => {
		const ks = kinds(`SELECT DISTINCT ON (a) a, b FROM t ORDER BY a, b;`);
		expect(ks).toContain("distinct_on");
	});

	it("emits on_conflict for ON CONFLICT", () => {
		const ks = kinds(
			`INSERT INTO t (id, a) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET a = 2;`,
		);
		expect(ks).toContain("on_conflict");
	});

	it("rejects NATURAL JOIN with a hint", () => {
		const result = parseSql(`SELECT * FROM a NATURAL JOIN b;`, "postgres");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/NATURAL JOIN/i);
	});
});
