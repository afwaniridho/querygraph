import { describe, expect, it } from "vitest";
import { MYSQL_PLAN_EXAMPLES, PLAN_EXAMPLES } from "../explain/examples";
import { EXPLAIN_FIXTURES } from "../explain/fixtures";
import { analyzePlan } from "../explain/health";
import {
	estimateRatio,
	filteringPercent,
	totalActualRows,
	totalActualTime,
} from "../explain/metrics";
import { parseMysqlPlan } from "../explain/mysql-parser";
import { parsePostgresPlan } from "../explain/parser";
import { PlanParseError } from "../explain/types";

const wrap = (Plan: Record<string, unknown>, extra = {}) =>
	JSON.stringify([{ Plan, ...extra }]);
const node = (extra: Record<string, unknown> = {}) => ({
	"Node Type": "Seq Scan",
	"Plan Rows": 10,
	...extra,
});

describe("MySQL EXPLAIN FORMAT=JSON parser", () => {
	it("parses existing raw MySQL JSON", () => {
		expect(
			parseMysqlPlan(
				JSON.stringify({
					query_block: { table: { table_name: "users", access_type: "ALL" } },
				}),
			).nodes,
		).toHaveLength(2);
	});

	it("parses a query_block root and single table access", () => {
		const parsed = parseMysqlPlan(
			JSON.stringify({
				query_block: {
					select_id: 1,
					cost_info: { query_cost: "12.50" },
					table: {
						table_name: "orders",
						access_type: "ref",
						possible_keys: ["orders_customer_id_idx"],
						key: "orders_customer_id_idx",
						used_key_parts: ["customer_id"],
						key_length: "8",
						ref: ["const"],
						rows_examined_per_scan: 3,
						rows_produced_per_join: 3,
						filtered: "100.00",
						attached_condition: "(`orders`.`customer_id` = 7)",
						using_index: true,
						cost_info: {
							read_cost: "1.20",
							eval_cost: "0.30",
							prefix_cost: "1.50",
							data_read_per_join: "2K",
						},
						used_columns: ["id", "customer_id"],
						future_field: { preserved: true },
					},
				},
			}),
		);
		expect(parsed.database).toBe("mysql");
		expect(parsed.nodes.map((item) => item.id)).toEqual(["plan-0", "plan-0-0"]);
		const table = parsed.nodes[1];
		expect(table.nodeType).toBe("Ref Lookup");
		expect(table.tableName).toBe("orders");
		expect(table.key).toBe("orders_customer_id_idx");
		expect(table.prefixCost).toBe(1.5);
		expect(table.raw.future_field).toEqual({ preserved: true });
	});

	it("parses nested loops and operation wrappers", () => {
		const parsed = parseMysqlPlan(MYSQL_PLAN_EXAMPLES[2].json);
		expect(parsed.nodes.map((item) => item.nodeType)).toEqual([
			"Select #1",
			"Nested Loop",
			"Range Scan",
			"Ref Lookup",
		]);
		expect(parsed.nodeById["plan-0-0-1"].parentRelationship).toBe(
			"inner input 1",
		);
		const ordering = parseMysqlPlan(MYSQL_PLAN_EXAMPLES[3].json);
		expect(ordering.nodes.map((item) => item.nodeType)).toContain(
			"Ordering Operation",
		);
		expect(ordering.nodes.some((item) => item.usingFilesort)).toBe(true);
		const grouping = parseMysqlPlan(MYSQL_PLAN_EXAMPLES[4].json);
		expect(grouping.nodes.map((item) => item.nodeType)).toContain(
			"Grouping Operation",
		);
		expect(grouping.nodes.some((item) => item.usingTemporaryTable)).toBe(true);
	});

	it("parses materialized subqueries", () => {
		const parsed = parseMysqlPlan(MYSQL_PLAN_EXAMPLES[5].json);
		expect(parsed.nodes.map((item) => item.nodeType)).toContain(
			"Materialized Subquery",
		);
		expect(parsed.nodes.some((item) => item.materializedFromSubquery)).toBe(
			true,
		);
	});

	it("accepts common copied MySQL JSON wrappers", () => {
		const raw = {
			query_block: {
				select_id: 1,
				table: { table_name: "users", access_type: "ALL" },
			},
		};
		const explain = JSON.stringify(raw);
		expect(
			parseMysqlPlan(JSON.stringify([{ EXPLAIN: explain }])).database,
		).toBe("mysql");
		expect(parseMysqlPlan(JSON.stringify({ EXPLAIN: explain })).database).toBe(
			"mysql",
		);
		expect(parseMysqlPlan(JSON.stringify(explain)).database).toBe("mysql");
		expect(
			parseMysqlPlan(JSON.stringify({ workbench_result: raw })).nodes,
		).toHaveLength(2);
	});

	it.each([
		["", "empty"],
		["{", "invalid-json"],
		["EXPLAIN SELECT 1", "invalid-json"],
		[JSON.stringify("-> Table scan on t"), "invalid-structure"],
		[JSON.stringify([{ Plan: { "Node Type": "Seq Scan" } }]), "missing-plan"],
		[JSON.stringify({ Plan: { "Node Type": "Seq Scan" } }), "missing-plan"],
	])("rejects non-MySQL JSON %#", (input, code) => {
		expect(() => parseMysqlPlan(input)).toThrow(PlanParseError);
		try {
			parseMysqlPlan(input);
		} catch (error) {
			expect((error as PlanParseError).code).toBe(code);
		}
	});

	it("enforces input, depth, and node limits", () => {
		expect(() =>
			parseMysqlPlan(
				JSON.stringify({
					query_block: { table: { table_name: "t", padding: "x".repeat(100) } },
				}),
				{ maxInputBytes: 20, maxNodes: 10, maxDepth: 10 },
			),
		).toThrow(/input limit/);
		expect(() =>
			parseMysqlPlan(MYSQL_PLAN_EXAMPLES[2].json, {
				maxInputBytes: 10_000,
				maxNodes: 2,
				maxDepth: 10,
			}),
		).toThrow(/node limit/);
		expect(() =>
			parseMysqlPlan(MYSQL_PLAN_EXAMPLES[5].json, {
				maxInputBytes: 10_000,
				maxNodes: 10,
				maxDepth: 1,
			}),
		).toThrow(/maximum depth/);
	});
});

describe("PostgreSQL EXPLAIN parser", () => {
	it("parses existing raw PostgreSQL JSON", () => {
		expect(parsePostgresPlan(wrap(node())).nodes).toHaveLength(1);
	});

	it("parses estimated plans and stable IDs", () => {
		const input = wrap(
			node({ Plans: [node({ "Node Type": "Index Scan" }), node()] }),
		);
		const first = parsePostgresPlan(input);
		const second = parsePostgresPlan(input);
		expect(first.analyzed).toBe(false);
		expect(first.nodes.map((item) => item.id)).toEqual([
			"plan-0",
			"plan-0-0",
			"plan-0-1",
		]);
		expect(second.nodes.map((item) => item.id)).toEqual(
			first.nodes.map((item) => item.id),
		);
		expect(first.maxDepth).toBe(1);
	});

	it("parses analyze, buffers, loops, sort, hash, workers, and unicode", () => {
		const plan = parsePostgresPlan(
			wrap(
				node({
					"Node Type": "Sort",
					"Relation Name": "注文",
					"Actual Rows": 7,
					"Actual Loops": 3,
					"Actual Total Time": 2.5,
					"Shared Hit Blocks": 9,
					"Sort Method": "external merge",
					"Sort Space Type": "Disk",
					"Hash Buckets": 128,
					"Hash Batches": 2,
					Workers: [{ "Worker Number": 0, "Actual Rows": 4 }],
					"Future Property": { nested: true },
				}),
				{ "Planning Time": 1, "Execution Time": 8 },
			),
		);
		const root = plan.nodes[0];
		expect(plan.analyzed).toBe(true);
		expect(plan.hasBuffers).toBe(true);
		expect(root.relationName).toBe("注文");
		expect(root.sortMethod).toBe("external merge");
		expect(root.hashBatches).toBe(2);
		expect(root.workers[0].number).toBe(0);
		expect(root.raw["Future Property"]).toEqual({ nested: true });
	});

	it("accepts unambiguous top-level and root-node objects", () => {
		expect(
			parsePostgresPlan(JSON.stringify({ Plan: node() })).nodes,
		).toHaveLength(1);
		expect(parsePostgresPlan(JSON.stringify(node())).nodes).toHaveLength(1);
	});

	it("accepts common copied PostgreSQL QUERY PLAN wrappers", () => {
		const raw = [{ Plan: node({ "Relation Name": "users" }) }];
		expect(
			parsePostgresPlan(JSON.stringify([{ "QUERY PLAN": raw }])).nodes[0]
				.relationName,
		).toBe("users");
		expect(
			parsePostgresPlan(JSON.stringify({ "QUERY PLAN": raw })).nodes[0]
				.nodeType,
		).toBe("Seq Scan");
		expect(
			parsePostgresPlan(JSON.stringify({ "QUERY PLAN": JSON.stringify(raw) }))
				.database,
		).toBe("postgresql");
	});

	it.each([
		["", "empty"],
		["{", "invalid-json"],
		["Seq Scan on users", "invalid-json"],
		["[]", "invalid-structure"],
		['{"query_block":{}}', "invalid-structure"],
		['{"Plan":{}}', "missing-plan"],
	])("rejects malformed input %#", (input, code) => {
		expect(() => parsePostgresPlan(input)).toThrow(PlanParseError);
		try {
			parsePostgresPlan(input);
		} catch (error) {
			expect((error as PlanParseError).code).toBe(code);
		}
	});

	it("ignores malformed optional numbers", () => {
		const plan = parsePostgresPlan(
			wrap(node({ "Actual Rows": "many", "Total Cost": Number.NaN })),
		);
		expect(plan.nodes[0].actualRows).toBeUndefined();
		expect(plan.nodes[0].totalCost).toBeUndefined();
	});

	it("enforces input, depth, and node limits", () => {
		expect(() =>
			parsePostgresPlan(wrap(node({ padding: "x".repeat(100) })), {
				maxInputBytes: 20,
				maxNodes: 10,
				maxDepth: 10,
			}),
		).toThrow(/input limit/);
		expect(() =>
			parsePostgresPlan(wrap(node({ Plans: [node(), node()] })), {
				maxInputBytes: 10_000,
				maxNodes: 2,
				maxDepth: 10,
			}),
		).toThrow(/node limit/);
		expect(() =>
			parsePostgresPlan(wrap(node({ Plans: [node({ Plans: [node()] })] })), {
				maxInputBytes: 10_000,
				maxNodes: 10,
				maxDepth: 1,
			}),
		).toThrow(/maximum depth/);
	});
});

describe("EXPLAIN fixture corpus", () => {
	it.each(
		EXPLAIN_FIXTURES,
	)("parses $id as $database with non-empty nodes", (fixture) => {
		const parsed =
			fixture.database === "mysql"
				? parseMysqlPlan(fixture.json)
				: parsePostgresPlan(fixture.json);
		expect(parsed.database).toBe(fixture.database);
		expect(parsed.nodes.length).toBeGreaterThan(0);
	});

	it("preserves selected PostgreSQL fixture properties", () => {
		const byId = Object.fromEntries(
			EXPLAIN_FIXTURES.filter((item) => item.database === "postgresql").map(
				(item) => [item.id, parsePostgresPlan(item.json)],
			),
		);
		expect(byId["postgres-buffers"].hasBuffers).toBe(true);
		expect(byId["postgres-analyze"].analyzed).toBe(true);
		expect(
			byId["postgres-cte"].nodes.some(
				(item) => item.cteName === "active_users",
			),
		).toBe(true);
	});

	it("preserves selected MySQL fixture properties", () => {
		const byId = Object.fromEntries(
			EXPLAIN_FIXTURES.filter((item) => item.database === "mysql").map(
				(item) => [item.id, parseMysqlPlan(item.json)],
			),
		);
		expect(
			byId["mysql-filesort"].nodes.some((item) => item.usingFilesort),
		).toBe(true);
		expect(
			byId["mysql-temporary-table"].nodes.some(
				(item) => item.usingTemporaryTable,
			),
		).toBe(true);
		expect(
			byId["mysql-materialized-subquery"].nodes.some(
				(item) => item.materializedFromSubquery,
			),
		).toBe(true);
	});
});

describe("plan metrics", () => {
	it("derives loop-aware metrics without changing inclusive semantics", () => {
		const parsed = parsePostgresPlan(
			wrap(
				node({
					"Plan Rows": 50,
					"Actual Rows": 10,
					"Actual Loops": 4,
					"Actual Total Time": 2.5,
					"Rows Removed by Filter": 90,
				}),
			),
		).nodes[0];
		expect(totalActualRows(parsed)).toBe(40);
		expect(totalActualTime(parsed)).toBe(10);
		expect(estimateRatio(parsed)).toBe(5);
		expect(filteringPercent(parsed)).toBe(90);
	});

	it("handles zero estimates safely", () => {
		const parsed = parsePostgresPlan(
			wrap(node({ "Plan Rows": 0, "Actual Rows": 20 })),
		).nodes[0];
		expect(estimateRatio(parsed)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("Plan Health", () => {
	it("produces every example's expected findings", () => {
		for (const example of PLAN_EXAMPLES) {
			const ids = analyzePlan(parsePostgresPlan(example.json)).map(
				(item) => item.ruleId,
			);
			for (const expected of example.expectedFindingIds) {
				expect(ids, example.id).toContain(expected);
			}
		}
	});

	it("detects join filtering, heap fetches, and planning dominance", () => {
		const parsed = parsePostgresPlan(
			wrap(
				node({
					"Node Type": "Index Only Scan",
					"Plan Rows": 2_000,
					"Actual Rows": 2_000,
					"Actual Loops": 1,
					"Heap Fetches": 1_500,
					"Rows Removed by Join Filter": 20_000,
				}),
				{ "Planning Time": 20, "Execution Time": 5 },
			),
		);
		const ids = analyzePlan(parsed).map((item) => item.ruleId);
		expect(ids).toContain("join-filter-loss");
		expect(ids).toContain("heap-fetches");
		expect(ids).toContain("planning-dominates");
	});

	it("avoids rule false positives at volume and ratio boundaries", () => {
		const parsed = parsePostgresPlan(
			wrap(
				node({
					"Plan Rows": 10,
					"Actual Rows": 90,
					"Actual Loops": 1,
					"Actual Total Time": 0.5,
					"Rows Removed by Filter": 900,
					"Hash Batches": 1,
				}),
				{ "Planning Time": 1, "Execution Time": 0.9 },
			),
		);
		expect(analyzePlan(parsed)).toEqual([]);
	});

	it("does not flag ordinary sequential scans", () => {
		const parsed = parsePostgresPlan(wrap(node({ "Plan Rows": 50_000 })));
		expect(
			analyzePlan(parsed).some(
				(item) => item.ruleId === "high-seq-scan-workload",
			),
		).toBe(false);
	});

	it("does not mistake non-hash temporary I/O for hash batching", () => {
		const parsed = parsePostgresPlan(
			wrap(
				node({
					"Node Type": "Sort",
					"Temp Read Blocks": 100,
					"Temp Written Blocks": 100,
				}),
			),
		);
		expect(
			analyzePlan(parsed).some((item) => item.ruleId === "hash-batching"),
		).toBe(false);
	});

	it("produces every MySQL example's expected findings", () => {
		for (const example of MYSQL_PLAN_EXAMPLES) {
			const ids = analyzePlan(parseMysqlPlan(example.json)).map(
				(item) => item.ruleId,
			);
			for (const expected of example.expectedFindingIds) {
				expect(ids, example.id).toContain(expected);
			}
		}
	});
});
