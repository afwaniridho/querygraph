import { describe, expect, it } from "vitest";
import { PLAN_EXAMPLES } from "../explain/examples";
import { analyzePlan } from "../explain/health";
import {
	estimateRatio,
	filteringPercent,
	totalActualRows,
	totalActualTime,
} from "../explain/metrics";
import { parsePostgresPlan } from "../explain/parser";
import { PlanParseError } from "../explain/types";

const wrap = (Plan: Record<string, unknown>, extra = {}) =>
	JSON.stringify([{ Plan, ...extra }]);
const node = (extra: Record<string, unknown> = {}) => ({
	"Node Type": "Seq Scan",
	"Plan Rows": 10,
	...extra,
});

describe("PostgreSQL EXPLAIN parser", () => {
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

	it.each([
		["", "empty"],
		["{", "invalid-json"],
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
});
