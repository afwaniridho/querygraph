import { describe, expect, it } from "vitest";
import { parseSql } from "#/lib/parse";

function parse(sql: string) {
	return parseSql(sql, "mysql");
}

function kinds(sql: string): string[] {
	const result = parse(sql);
	expect(result.error).toBeUndefined();
	return result.nodes.map((n) => n.data.kind as string);
}

function labels(sql: string): string[] {
	const result = parse(sql);
	expect(result.error).toBeUndefined();
	return result.nodes.map((n) => n.data.label as string);
}

describe("mysql adapter", () => {
	it("reads backtick-quoted identifiers without quotes in labels", () => {
		const ls = labels(
			"SELECT `c`.`name` FROM `customers` `c` WHERE `c`.`id` > 1;",
		);
		const joined = ls.join(" | ");
		expect(joined).not.toContain("`");
		expect(joined).toContain("customers");
	});

	it("expands LIMIT a,b into OFFSET form", () => {
		const ls = labels("SELECT * FROM t LIMIT 5, 10;");
		const limit = ls.find((l) => l.startsWith("LIMIT"));
		expect(limit).toBe("LIMIT 10 OFFSET 5");
	});

	it("emits on_duplicate_key for ON DUPLICATE KEY UPDATE", () => {
		const ks = kinds(
			"INSERT INTO t (a, b) VALUES (1, 2) ON DUPLICATE KEY UPDATE b = b + 1;",
		);
		expect(ks).toContain("insert");
		expect(ks).toContain("on_duplicate_key");
	});

	it("emits insert_ignore for INSERT IGNORE", () => {
		const ks = kinds("INSERT IGNORE INTO t (a) VALUES (1);");
		expect(ks).toContain("insert_ignore");
	});

	it("emits replace for REPLACE INTO", () => {
		const ks = kinds("REPLACE INTO t (a, b) VALUES (1, 2);");
		expect(ks).toContain("replace");
	});

	it("emits multi_table_update for a joined UPDATE", () => {
		const ks = kinds(
			"UPDATE t1 JOIN t2 ON t1.id = t2.id SET t1.x = t2.y WHERE t1.id > 5;",
		);
		expect(ks).toContain("multi_table_update");
		expect(ks).toContain("set");
	});

	it("emits multi_table_delete for a joined DELETE", () => {
		const ks = kinds(
			"DELETE t1, t2 FROM t1 INNER JOIN t2 ON t1.id = t2.id WHERE t1.id < 3;",
		);
		expect(ks).toContain("multi_table_delete");
	});

	it("emits straight_join for STRAIGHT_JOIN", () => {
		const ks = kinds("SELECT * FROM t1 STRAIGHT_JOIN t2 ON t1.id = t2.id;");
		expect(ks).toContain("straight_join");
	});

	it("handles WITH RECURSIVE", () => {
		const result = parse(
			`WITH RECURSIVE cte AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM cte WHERE n < 5
) SELECT * FROM cte;`,
		);
		expect(result.error).toBeUndefined();
		const ks = result.nodes.map((n) => n.data.kind as string);
		expect(ks).toContain("cte");
		expect(result.edges.some((e) => e.type === "recursive")).toBe(true);
	});

	it("handles window functions in a projection", () => {
		const result = parse(
			"SELECT id, row_number() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn FROM emp;",
		);
		expect(result.error).toBeUndefined();
		const select = result.nodes.find((n) => n.data.kind === "select");
		expect(select?.data.label).toContain("OVER");
		expect(select?.data.label).toContain("PARTITION BY");
	});

	it("handles CREATE TABLE with AUTO_INCREMENT", () => {
		const result = parse(
			"CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
		);
		expect(result.error).toBeUndefined();
		const ks = result.nodes.map((n) => n.data.kind as string);
		expect(ks).toContain("create");
		expect(ks).toContain("column");
		const idCol = result.nodes.find(
			(n) => n.data.kind === "column" && String(n.data.label).startsWith("id"),
		);
		expect(idCol?.data.label).toContain("AUTO_INCREMENT");
	});

	it("hints that FULL OUTER JOIN is unsupported", () => {
		const result = parse("SELECT * FROM a FULL OUTER JOIN b ON a.id = b.id;");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/FULL OUTER JOIN/i);
	});
});
