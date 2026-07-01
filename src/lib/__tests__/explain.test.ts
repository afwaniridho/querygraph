import { describe, expect, it } from "vitest";
import { rankPlanBottlenecks } from "../explain/bottlenecks";
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
import {
	isMysqlTreeOutput,
	parseMysqlTreePlan,
} from "../explain/mysql-tree-parser";
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

	it("accepts copied MySQL TREE result wrappers", () => {
		const tree =
			"-> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.05 rows=4 loops=1)";
		expect(parseMysqlPlan(JSON.stringify([{ EXPLAIN: tree }])).raw.format).toBe(
			"tree",
		);
		expect(parseMysqlPlan(JSON.stringify({ EXPLAIN: tree })).raw.format).toBe(
			"tree",
		);
		expect(parseMysqlPlan(JSON.stringify(tree)).raw.format).toBe("tree");
	});

	it.each([
		["", "empty"],
		["{", "invalid-json"],
		["EXPLAIN SELECT 1", "invalid-json"],
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

describe("isMysqlTreeOutput detector", () => {
	it.each([
		[JSON.stringify({ query_block: {} }), false],
		[JSON.stringify([{ EXPLAIN: "{}" }]), false],
		["-> Table scan on t1  (cost=1.10 rows=4)", true],
		[
			"-> Nested loop  (cost=2.40 rows=2) (actual time=0.05..0.08 rows=2 loops=1)",
			true,
		],
		["EXPLAIN: -> Filter: (t1.id > 10)  (cost=1.25 rows=3)", true],
		["SELECT * FROM users WHERE id = 1", false],
		["id\tselect_type\ttable\ntype\n1\tSIMPLE\tusers\tALL", false],
		["", false],
	])("classifies input %#", (input, expected) => {
		expect(isMysqlTreeOutput(input)).toBe(expected);
	});
});

describe("MySQL EXPLAIN ANALYZE TREE parser", () => {
	it("parses a simple analyzed TREE node with runtime fields", () => {
		const parsed = parseMysqlTreePlan(
			"-> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.05 rows=4 loops=1)",
		);
		expect(parsed.database).toBe("mysql");
		expect(parsed.analyzed).toBe(true);
		expect(parsed.nodes).toHaveLength(1);
		const root = parsed.nodes[0];
		expect(root.id).toBe("plan-0");
		expect(root.nodeType).toBe("Table scan on t1");
		expect(root.tableName).toBe("t1");
		expect(root.startupCost).toBeUndefined();
		expect(root.totalCost).toBe(1.1);
		expect(root.planRows).toBe(4);
		expect(root.actualStartupTime).toBe(0.02);
		expect(root.actualTotalTime).toBe(0.05);
		expect(root.actualRows).toBe(4);
		expect(root.actualLoops).toBe(1);
	});

	it("parses nested hierarchy with correct ids, depths, and siblings", () => {
		const parsed = parseMysqlTreePlan(
			`-> Nested loop inner join  (cost=2.40 rows=2) (actual time=0.05..0.08 rows=2 loops=1)
    -> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.03 rows=4 loops=1)
    -> Index lookup on t2 using idx (t2.a=t1.id)  (cost=0.30 rows=1) (actual time=0.01..0.01 rows=1 loops=4)`,
		);
		expect(parsed.nodes.map((item) => item.id)).toEqual([
			"plan-0",
			"plan-0-0",
			"plan-0-1",
		]);
		expect(parsed.nodes.map((item) => item.depth)).toEqual([0, 1, 1]);
		expect(parsed.nodeById["plan-0"].childIds).toEqual([
			"plan-0-0",
			"plan-0-1",
		]);
		const lookup = parsed.nodeById["plan-0-1"];
		expect(lookup.parentId).toBe("plan-0");
		expect(lookup.tableName).toBe("t2");
		expect(lookup.key).toBe("idx");
		expect(lookup.actualLoops).toBe(4);
		expect(parsed.maxDepth).toBe(1);
	});

	it("parses cost-only TREE as not analyzed", () => {
		const parsed = parseMysqlTreePlan(
			`-> Sort: t1.created_at  (cost=12.30 rows=100)
    -> Table scan on t1  (cost=10.00 rows=100)`,
		);
		expect(parsed.analyzed).toBe(false);
		expect(parsed.nodes).toHaveLength(2);
		expect(parsed.nodes[0].totalCost).toBe(12.3);
		expect(parsed.nodes[0].actualRows).toBeUndefined();
	});

	it("supports cost ranges and the EXPLAIN: prefix", () => {
		const parsed = parseMysqlTreePlan(
			`EXPLAIN: -> Filter: (t1.id > 10)  (cost=1.00..1.25 rows=3) (actual time=0.030..0.050 rows=2 loops=1)
    -> Table scan on t1  (cost=1.25 rows=10) (actual time=0.010..0.020 rows=10 loops=1)`,
		);
		expect(parsed.nodes[0].nodeType).toBe("Filter: (t1.id > 10)");
		expect(parsed.nodes[0].startupCost).toBe(1);
		expect(parsed.nodes[0].totalCost).toBe(1.25);
		expect(parsed.nodes).toHaveLength(2);
	});

	it("preserves costless internal nodes such as Hash", () => {
		const parsed = parseMysqlTreePlan(
			`-> Hash
    -> Table scan on t2  (cost=1.00 rows=100)`,
		);
		expect(parsed.nodes[0].nodeType).toBe("Hash");
		expect(parsed.nodes[0].totalCost).toBeUndefined();
		expect(parsed.nodes[0].childIds).toEqual(["plan-0-0"]);
	});

	it("parses scientific and engineering notation values", () => {
		const parsed = parseMysqlTreePlan(
			"-> Table scan on big  (cost=1.5e3 rows=2.0e6) (actual time=0.05..1.2e2 rows=1e6 loops=1)",
		);
		const root = parsed.nodes[0];
		expect(root.totalCost).toBe(1500);
		expect(root.planRows).toBe(2_000_000);
		expect(root.actualTotalTime).toBe(120);
		expect(root.actualRows).toBe(1_000_000);
	});

	it("treats lines without arrows as continuation of the previous node", () => {
		const parsed = parseMysqlTreePlan(
			`-> Filter: (t1.col = 'a really long predicate that wraps'
       and t1.other = 5)  (cost=1.25 rows=3) (actual time=0.03..0.05 rows=2 loops=1)
    -> Table scan on t1  (cost=1.25 rows=10) (actual time=0.01..0.02 rows=10 loops=1)`,
		);
		expect(parsed.nodes).toHaveLength(2);
		expect(parsed.nodes[0].planRows).toBe(3);
		expect(parsed.nodes[0].actualRows).toBe(2);
		expect(parsed.nodes[0].raw.continuations).toEqual([
			"and t1.other = 5)  (cost=1.25 rows=3) (actual time=0.03..0.05 rows=2 loops=1)",
		]);
	});

	it("handles tab indentation consistently", () => {
		const parsed = parseMysqlTreePlan(
			"-> Nested loop  (cost=2.40 rows=2) (actual time=0.05..0.08 rows=2 loops=1)\n\t-> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.03 rows=4 loops=1)",
		);
		expect(parsed.nodes.map((item) => item.id)).toEqual(["plan-0", "plan-0-0"]);
		expect(parsed.nodes[1].depth).toBe(1);
	});

	it("marks never-executed nodes as not having runtime rows", () => {
		const parsed = parseMysqlTreePlan(
			`-> Nested loop  (cost=2.40 rows=2) (actual time=0.05..0.08 rows=2 loops=1)
    -> Index lookup on t2 using idx  (cost=0.30 rows=1) (never executed)`,
		);
		expect(parsed.nodes[1].actualRows).toBeUndefined();
		expect(parsed.analyzed).toBe(true);
	});

	it("rejects empty and node-free TREE input", () => {
		expect(() => parseMysqlTreePlan("")).toThrow(PlanParseError);
		try {
			parseMysqlTreePlan("");
		} catch (error) {
			expect((error as PlanParseError).code).toBe("empty");
		}
	});

	it("rejects multi-root TREE input", () => {
		expect(() =>
			parseMysqlTreePlan(
				`-> Table scan on t1  (cost=1.10 rows=4)
-> Table scan on t2  (cost=1.10 rows=4)`,
			),
		).toThrow(/multiple root/);
	});

	it("enforces input, depth, and node limits", () => {
		expect(() =>
			parseMysqlTreePlan("-> Table scan on t1  (cost=1.10 rows=4)", {
				maxInputBytes: 5,
				maxNodes: 10,
				maxDepth: 10,
			}),
		).toThrow(/input limit/);
		expect(() =>
			parseMysqlTreePlan(
				`-> Nested loop  (cost=2.40 rows=2)
    -> Table scan on t1  (cost=1.10 rows=4)`,
				{ maxInputBytes: 10_000, maxNodes: 1, maxDepth: 10 },
			),
		).toThrow(/node limit/);
		expect(() =>
			parseMysqlTreePlan(
				`-> Nested loop  (cost=2.40 rows=2)
    -> Table scan on t1  (cost=1.10 rows=4)`,
				{ maxInputBytes: 10_000, maxNodes: 10, maxDepth: 0 },
			),
		).toThrow(/maximum depth/);
	});

	it("dispatches raw TREE text through parseMysqlPlan", () => {
		const parsed = parseMysqlPlan(
			"-> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.05 rows=4 loops=1)",
		);
		expect(parsed.database).toBe("mysql");
		expect(parsed.analyzed).toBe(true);
		expect(parsed.raw.format).toBe("tree");
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

describe("plan bottlenecks", () => {
	it("ranks actual time without aggregating child time", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Node Type": "Nested Loop",
						"Actual Rows": 1,
						"Actual Total Time": 50,
						Plans: [
							node({
								"Node Type": "Index Scan",
								"Actual Rows": 1,
								"Actual Total Time": 80,
							}),
						],
					}),
				),
			),
		);
		const actualTime = ranked.find((section) => section.kind === "actual-time");
		expect(actualTime?.items[0]).toMatchObject({
			nodeId: "plan-0-0",
			value: 80,
		});
	});

	it("ranks loop-aware repeated work from inclusive time times loops", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Actual Rows": 5,
						"Actual Total Time": 20,
						"Actual Loops": 2,
						Plans: [
							node({
								"Actual Rows": 1,
								"Actual Total Time": 3,
								"Actual Loops": 50,
							}),
						],
					}),
				),
			),
		);
		const repeated = ranked.find(
			(section) => section.kind === "loop-aware-time",
		);
		expect(repeated?.items[0]).toMatchObject({
			nodeId: "plan-0-0",
			value: 150,
		});
		expect(repeated?.items[0].evidence).toContain("loop-aware inclusive work");
	});

	it("ranks cardinality mismatches using actual rows per loop", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Plan Rows": 10,
						"Actual Rows": 10,
						Plans: [
							node({
								"Plan Rows": 5,
								"Actual Rows": 500,
							}),
						],
					}),
				),
			),
		);
		const mismatch = ranked.find(
			(section) => section.kind === "cardinality-mismatch",
		);
		expect(mismatch?.items).toHaveLength(1);
		expect(mismatch?.items[0]).toMatchObject({
			nodeId: "plan-0-0",
			value: 100,
		});
	});

	it("ranks rows removed by filter and join filter together", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Actual Rows": 10,
						"Rows Removed by Filter": 40,
						Plans: [
							node({
								"Actual Rows": 10,
								"Rows Removed by Join Filter": 90,
							}),
						],
					}),
				),
			),
		);
		const removed = ranked.find((section) => section.kind === "rows-removed");
		expect(removed?.items[0]).toMatchObject({
			nodeId: "plan-0-0",
			value: 90,
		});
		expect(removed?.items[0].evidence).toContain("by join filter");
	});

	it("ranks temp I/O, disk sort, and hash batching", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Actual Rows": 10,
						"Actual Total Time": 1,
						Plans: [
							node({
								"Node Type": "Sort",
								"Actual Rows": 10,
								"Actual Total Time": 1,
								"Sort Method": "external merge",
								"Sort Space Used": 400,
								"Sort Space Type": "Disk",
							}),
							node({
								"Node Type": "Hash",
								"Actual Rows": 10,
								"Actual Total Time": 1,
								"Hash Batches": 8,
								"Temp Read Blocks": 100,
								"Temp Written Blocks": 60,
							}),
						],
					}),
				),
			),
		);
		const temp = ranked.find((section) => section.kind === "temp-io");
		expect(temp?.items.map((item) => item.nodeId)).toEqual([
			"plan-0-0",
			"plan-0-1",
		]);
		expect(temp?.items[0].evidence).toContain("external merge");
		expect(temp?.items[1].evidence).toContain("hash batches");
	});

	it("ranks estimated cost and rows for estimated plans", () => {
		const ranked = rankPlanBottlenecks(
			parsePostgresPlan(
				wrap(
					node({
						"Total Cost": 10,
						"Plan Rows": 50,
						Plans: [
							node({
								"Node Type": "Index Scan",
								"Total Cost": 200,
								"Plan Rows": 10_000,
							}),
						],
					}),
				),
			),
		);
		expect(
			ranked.find((section) => section.kind === "estimated-cost")?.items[0],
		).toMatchObject({ nodeId: "plan-0-0", value: 200 });
		expect(
			ranked.find((section) => section.kind === "estimated-rows")?.items[0],
		).toMatchObject({ nodeId: "plan-0-0", value: 10_000 });
	});

	it("returns no sections when no useful metrics are present", () => {
		expect(
			rankPlanBottlenecks(
				parsePostgresPlan(wrap({ "Node Type": "Result", "Actual Rows": 1 })),
			),
		).toEqual([]);
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

describe("MySQL analyzed TREE analysis", () => {
	const analyzedTree = `-> Nested loop inner join  (cost=2.40 rows=2) (actual time=0.05..50.0 rows=2 loops=1)
    -> Table scan on t1  (cost=1.10 rows=4) (actual time=0.02..0.03 rows=4 loops=1)
    -> Index lookup on t2 using idx  (cost=0.30 rows=5) (actual time=0.10..5.0 rows=1000 loops=200)`;

	it("produces actual-time bottleneck sections for analyzed MySQL TREE", () => {
		const plan = parseMysqlPlan(analyzedTree);
		expect(plan.analyzed).toBe(true);
		const ranked = rankPlanBottlenecks(plan);
		const kinds = ranked.map((section) => section.kind);
		expect(kinds).toContain("actual-time");
		expect(kinds).toContain("loop-aware-time");
		expect(kinds).not.toContain("temp-io");
		expect(kinds).not.toContain("rows-removed");
		const actualTime = ranked.find((s) => s.kind === "actual-time");
		expect(actualTime?.items[0]).toMatchObject({ nodeId: "plan-0", value: 50 });
		const loopAware = ranked.find((s) => s.kind === "loop-aware-time");
		expect(loopAware?.items[0]).toMatchObject({
			nodeId: "plan-0-1",
			value: 1000,
		});
	});

	it("produces cardinality mismatch when estimate and actual differ", () => {
		const plan = parseMysqlPlan(analyzedTree);
		const ranked = rankPlanBottlenecks(plan);
		const mismatch = ranked.find((s) => s.kind === "cardinality-mismatch");
		expect(mismatch?.items[0]).toMatchObject({ nodeId: "plan-0-1" });
		expect(mismatch?.items[0].value).toBeGreaterThanOrEqual(100);
	});

	it("flags runtime cardinality mismatch and repeated inner operation", () => {
		const ids = analyzePlan(parseMysqlPlan(analyzedTree)).map(
			(item) => item.ruleId,
		);
		expect(ids).toContain("mysql-cardinality-mismatch");
		expect(ids).toContain("mysql-repeated-inner-operation");
	});

	it("keeps estimated MySQL JSON on estimated bottleneck sections", () => {
		const plan = parseMysqlPlan(MYSQL_PLAN_EXAMPLES[1].json);
		expect(plan.analyzed).toBe(false);
		const kinds = rankPlanBottlenecks(plan).map((section) => section.kind);
		expect(kinds).toContain("estimated-cost");
		expect(kinds).toContain("estimated-rows");
		expect(kinds).not.toContain("actual-time");
	});

	it("does not flag runtime findings on estimated MySQL JSON", () => {
		const ids = analyzePlan(parseMysqlPlan(MYSQL_PLAN_EXAMPLES[1].json)).map(
			(item) => item.ruleId,
		);
		expect(ids).not.toContain("mysql-cardinality-mismatch");
		expect(ids).not.toContain("mysql-repeated-inner-operation");
	});
});
