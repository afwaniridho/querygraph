import type { PlanDatabase } from "./types";

export interface PlanExample {
	id: string;
	database: PlanDatabase;
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
		database: "postgresql",
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
		database: "postgresql",
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
		database: "postgresql",
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
		database: "postgresql",
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
		database: "postgresql",
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
		database: "postgresql",
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
		database: "postgresql",
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

const mysqlPlan = (value: Record<string, unknown>) =>
	JSON.stringify(value, null, 2);

export const MYSQL_PLAN_EXAMPLES: PlanExample[] = [
	{
		id: "mysql-efficient-keyed-lookup",
		database: "mysql",
		title: "Efficient keyed lookup",
		objective: "See a selective MySQL index lookup without a forced warning.",
		notice: "Inspect the chosen key, used key parts, and small row estimate.",
		expectedFindingIds: [],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				cost_info: { query_cost: "1.20" },
				table: {
					table_name: "orders",
					access_type: "const",
					possible_keys: ["PRIMARY"],
					key: "PRIMARY",
					used_key_parts: ["id"],
					key_length: "8",
					ref: ["const"],
					rows_examined_per_scan: 1,
					rows_produced_per_join: 1,
					filtered: "100.00",
					using_index: true,
					cost_info: {
						read_cost: "0.10",
						eval_cost: "0.10",
						prefix_cost: "0.20",
						data_read_per_join: "1K",
					},
					used_columns: ["id", "customer_id", "total"],
				},
			},
		}),
	},
	{
		id: "mysql-full-scan-filtering",
		database: "mysql",
		title: "Full scan with filtering",
		objective: "Investigate a large MySQL full scan with selective filtering.",
		notice:
			"The scan is not automatically wrong; row estimates and filtering are the evidence.",
		expectedFindingIds: [
			"mysql-high-full-scan-workload",
			"mysql-low-filtered-large-scan",
			"mysql-no-possible-keys-filtered-scan",
		],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				cost_info: { query_cost: "52200.00" },
				table: {
					table_name: "events",
					access_type: "ALL",
					possible_keys: [],
					rows_examined_per_scan: 800000,
					rows_produced_per_join: 6400,
					filtered: "0.80",
					attached_condition: "(`events`.`status` = 'queued')",
					cost_info: {
						read_cost: "45000.00",
						eval_cost: "640.00",
						prefix_cost: "45640.00",
						data_read_per_join: "240M",
					},
				},
			},
		}),
	},
	{
		id: "mysql-nested-loop",
		database: "mysql",
		title: "Nested loop join",
		objective: "Follow MySQL nested-loop input order across table accesses.",
		notice:
			"The synthetic Nested Loop node preserves the access order from JSON.",
		expectedFindingIds: [],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				cost_info: { query_cost: "121.10" },
				nested_loop: [
					{
						table: {
							table_name: "customers",
							access_type: "range",
							possible_keys: ["customers_region_idx"],
							key: "customers_region_idx",
							used_key_parts: ["region"],
							rows_examined_per_scan: 120,
							rows_produced_per_join: 120,
							filtered: "100.00",
						},
					},
					{
						table: {
							table_name: "orders",
							access_type: "ref",
							possible_keys: ["orders_customer_id_idx"],
							key: "orders_customer_id_idx",
							used_key_parts: ["customer_id"],
							ref: ["shop.customers.id"],
							rows_examined_per_scan: 4,
							rows_produced_per_join: 480,
							filtered: "100.00",
						},
					},
				],
			},
		}),
	},
	{
		id: "mysql-filesort",
		database: "mysql",
		title: "Filesort",
		objective: "Recognize MySQL filesort wording without implying disk I/O.",
		notice:
			"Filesort can be normal; large inputs are the reason to investigate.",
		expectedFindingIds: ["mysql-filesort"],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				ordering_operation: {
					using_filesort: true,
					table: {
						table_name: "orders",
						access_type: "ALL",
						rows_examined_per_scan: 250000,
						rows_produced_per_join: 250000,
						filtered: "100.00",
					},
				},
			},
		}),
	},
	{
		id: "mysql-temporary-grouping",
		database: "mysql",
		title: "Temporary grouping",
		objective:
			"Inspect GROUP BY-style work where MySQL reports a temporary table.",
		notice: "Temporary tables are contextual and often normal for grouping.",
		expectedFindingIds: ["mysql-temporary-table"],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				grouping_operation: {
					using_temporary_table: true,
					table: {
						table_name: "line_items",
						access_type: "index",
						key: "line_items_order_id_idx",
						rows_examined_per_scan: 180000,
						rows_produced_per_join: 180000,
						filtered: "100.00",
					},
				},
			},
		}),
	},
	{
		id: "mysql-materialized-subquery",
		database: "mysql",
		title: "Materialized subquery",
		objective: "Show a materialized subquery as a separate branch.",
		notice:
			"Materialization can be useful; the finding asks you to inspect scale.",
		expectedFindingIds: ["mysql-materialized-subquery"],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				table: {
					table_name: "<subquery2>",
					access_type: "ALL",
					rows_examined_per_scan: 5000,
					rows_produced_per_join: 5000,
					filtered: "100.00",
					materialized_from_subquery: {
						query_block: {
							select_id: 2,
							table: {
								table_name: "payments",
								access_type: "range",
								key: "payments_created_at_idx",
								rows_examined_per_scan: 5000,
								rows_produced_per_join: 5000,
								filtered: "100.00",
							},
						},
					},
				},
			},
		}),
	},
	{
		id: "mysql-possible-keys-not-chosen",
		database: "mysql",
		title: "Possible keys not chosen",
		objective: "Review a large access where MySQL lists keys but chooses none.",
		notice:
			"The optimizer may still be correct; this is a prompt to investigate.",
		expectedFindingIds: ["mysql-possible-keys-not-chosen"],
		analyzed: false,
		json: mysqlPlan({
			query_block: {
				select_id: 1,
				cost_info: { query_cost: "18000.00" },
				table: {
					table_name: "audit_log",
					access_type: "ALL",
					possible_keys: ["audit_log_actor_idx", "audit_log_created_idx"],
					key: null,
					rows_examined_per_scan: 300000,
					rows_produced_per_join: 120000,
					filtered: "40.00",
					attached_condition: "(`audit_log`.`actor_id` = 42)",
					cost_info: { prefix_cost: "16000.00" },
				},
			},
		}),
	},
];

export const ALL_PLAN_EXAMPLES = [...PLAN_EXAMPLES, ...MYSQL_PLAN_EXAMPLES];
