export interface PlanExample {
	id: string;
	title: string;
	objective: string;
	notice: string;
	expectedFindingIds: string[];
	analyzed: boolean;
	json: string;
}

const plan = (value: Record<string, unknown>) =>
	JSON.stringify([value], null, 2);

export const PLAN_EXAMPLES: PlanExample[] = [
	{
		id: "efficient-index",
		title: "Efficient index scan",
		objective: "See a selective access path without a forced warning.",
		notice: "Compare the small estimate with actual rows and inspect buffers.",
		expectedFindingIds: [],
		analyzed: true,
		json: plan({
			"Planning Time": 0.22,
			"Execution Time": 0.08,
			Plan: {
				"Node Type": "Index Scan",
				"Relation Name": "orders",
				Alias: "orders",
				"Index Name": "orders_pkey",
				"Index Cond": "(id = 42)",
				"Startup Cost": 0.29,
				"Total Cost": 8.31,
				"Plan Rows": 1,
				"Plan Width": 48,
				"Actual Startup Time": 0.02,
				"Actual Total Time": 0.021,
				"Actual Rows": 1,
				"Actual Loops": 1,
				"Shared Hit Blocks": 3,
				"Shared Read Blocks": 0,
			},
		}),
	},
	{
		id: "filtering-loss",
		title: "Heavy filtering",
		objective: "Investigate a scan that discards most rows.",
		notice:
			"The sequential scan is contextual; the measured filtering loss is the stronger evidence.",
		expectedFindingIds: ["large-filtering-loss"],
		analyzed: true,
		json: plan({
			"Planning Time": 0.4,
			"Execution Time": 86.2,
			Plan: {
				"Node Type": "Seq Scan",
				"Relation Name": "events",
				Filter: "(status = 'queued')",
				"Startup Cost": 0,
				"Total Cost": 9210,
				"Plan Rows": 1200,
				"Plan Width": 64,
				"Actual Startup Time": 0.03,
				"Actual Total Time": 84.9,
				"Actual Rows": 950,
				"Actual Loops": 1,
				"Rows Removed by Filter": 499050,
				"Shared Hit Blocks": 4210,
			},
		}),
	},
	{
		id: "misestimate",
		title: "Cardinality misestimate",
		objective: "See how a large estimate error is reported conservatively.",
		notice: "Actual and estimated rows are compared per loop.",
		expectedFindingIds: ["cardinality-mismatch"],
		analyzed: true,
		json: plan({
			"Planning Time": 1.1,
			"Execution Time": 42.3,
			Plan: {
				"Node Type": "Bitmap Heap Scan",
				"Relation Name": "sessions",
				"Recheck Cond": "(tenant_id = 7)",
				"Startup Cost": 50,
				"Total Cost": 800,
				"Plan Rows": 120,
				"Plan Width": 32,
				"Actual Startup Time": 1.1,
				"Actual Total Time": 40.2,
				"Actual Rows": 18000,
				"Actual Loops": 1,
				Plans: [
					{
						"Node Type": "Bitmap Index Scan",
						"Index Name": "sessions_tenant_idx",
						"Index Cond": "(tenant_id = 7)",
						"Plan Rows": 120,
						"Actual Rows": 18000,
						"Actual Loops": 1,
						"Actual Total Time": 0.8,
					},
				],
			},
		}),
	},
	{
		id: "nested-loop",
		title: "Repeated nested-loop input",
		objective: "Find substantial work repeated for an inner operation.",
		notice:
			"Loop-aware child time is derived; it is not summed with inclusive parent time.",
		expectedFindingIds: ["repeated-inner-operation"],
		analyzed: true,
		json: plan({
			"Execution Time": 1820,
			Plan: {
				"Node Type": "Nested Loop",
				"Join Type": "Inner",
				"Plan Rows": 50000,
				"Actual Rows": 50000,
				"Actual Loops": 1,
				"Actual Total Time": 1800,
				Plans: [
					{
						"Node Type": "Seq Scan",
						"Parent Relationship": "Outer",
						"Relation Name": "accounts",
						"Plan Rows": 5000,
						"Actual Rows": 5000,
						"Actual Loops": 1,
						"Actual Total Time": 20,
					},
					{
						"Node Type": "Index Scan",
						"Parent Relationship": "Inner",
						"Relation Name": "transactions",
						"Index Name": "transactions_account_idx",
						"Index Cond": "(account_id = accounts.id)",
						"Plan Rows": 10,
						"Actual Rows": 10,
						"Actual Loops": 5000,
						"Actual Total Time": 0.3,
					},
				],
			},
		}),
	},
	{
		id: "sort-spill",
		title: "Sort spilling to disk",
		objective: "Recognize explicit external-sort evidence.",
		notice: "Disk use is reported from Sort Method and Sort Space Type.",
		expectedFindingIds: ["sort-spill"],
		analyzed: true,
		json: plan({
			"Execution Time": 640,
			Plan: {
				"Node Type": "Sort",
				"Sort Key": ["created_at DESC"],
				"Sort Method": "external merge",
				"Sort Space Used": 24576,
				"Sort Space Type": "Disk",
				"Plan Rows": 400000,
				"Actual Rows": 400000,
				"Actual Loops": 1,
				"Actual Total Time": 625,
				"Temp Read Blocks": 3072,
				"Temp Written Blocks": 3080,
				Plans: [
					{
						"Node Type": "Seq Scan",
						"Relation Name": "audit_log",
						"Plan Rows": 400000,
						"Actual Rows": 400000,
						"Actual Loops": 1,
						"Actual Total Time": 120,
					},
				],
			},
		}),
	},
	{
		id: "hash-batches",
		title: "Batched hash",
		objective: "Inspect a hash operation that needed multiple batches.",
		notice:
			"Multiple batches indicate memory pressure; they do not alone prove the root cause.",
		expectedFindingIds: ["hash-batching"],
		analyzed: true,
		json: plan({
			"Execution Time": 350,
			Plan: {
				"Node Type": "Hash Join",
				"Hash Cond": "(orders.customer_id = customers.id)",
				"Plan Rows": 220000,
				"Actual Rows": 220000,
				"Actual Loops": 1,
				"Actual Total Time": 340,
				Plans: [
					{
						"Node Type": "Seq Scan",
						"Parent Relationship": "Outer",
						"Relation Name": "orders",
						"Plan Rows": 220000,
						"Actual Rows": 220000,
						"Actual Loops": 1,
						"Actual Total Time": 80,
					},
					{
						"Node Type": "Hash",
						"Parent Relationship": "Inner",
						"Plan Rows": 80000,
						"Actual Rows": 80000,
						"Actual Loops": 1,
						"Actual Total Time": 72,
						"Hash Buckets": 65536,
						"Hash Batches": 8,
						"Peak Memory Usage": 4096,
						"Temp Written Blocks": 620,
						Plans: [
							{
								"Node Type": "Seq Scan",
								"Relation Name": "customers",
								"Plan Rows": 80000,
								"Actual Rows": 80000,
								"Actual Loops": 1,
								"Actual Total Time": 31,
							},
						],
					},
				],
			},
		}),
	},
	{
		id: "parallel",
		title: "Parallel aggregation",
		objective: "See worker metadata in a parallel plan.",
		notice: "Per-worker rows make genuine imbalance analysis possible.",
		expectedFindingIds: ["parallel-worker-imbalance"],
		analyzed: true,
		json: plan({
			"Execution Time": 92,
			Plan: {
				"Node Type": "Gather",
				"Workers Planned": 2,
				"Workers Launched": 2,
				"Plan Rows": 2,
				"Actual Rows": 3,
				"Actual Loops": 1,
				"Actual Total Time": 90,
				Plans: [
					{
						"Node Type": "Aggregate",
						"Parent Relationship": "Outer",
						Strategy: "Plain",
						"Parallel Aware": true,
						"Plan Rows": 1,
						"Actual Rows": 1,
						"Actual Loops": 3,
						"Actual Total Time": 80,
						Workers: [
							{
								"Worker Number": 0,
								"Actual Rows": 120000,
								"Actual Total Time": 78,
							},
							{
								"Worker Number": 1,
								"Actual Rows": 30000,
								"Actual Total Time": 75,
							},
						],
						Plans: [
							{
								"Node Type": "Seq Scan",
								"Relation Name": "measurements",
								"Parallel Aware": true,
								"Plan Rows": 150000,
								"Actual Rows": 150000,
								"Actual Loops": 3,
								"Actual Total Time": 68,
							},
						],
					},
				],
			},
		}),
	},
];
