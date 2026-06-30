import type { PlanDatabase } from "./types";

export interface ExplainFixture {
	id: string;
	database: PlanDatabase;
	category: string;
	json: string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const pg = (value: Record<string, unknown>) => json([value]);
const mysql = (queryBlock: Record<string, unknown>) =>
	json({ query_block: queryBlock });

const scan = (extra: Record<string, unknown> = {}) => ({
	"Node Type": "Seq Scan",
	"Relation Name": "users",
	"Startup Cost": 0,
	"Total Cost": 18,
	"Plan Rows": 100,
	"Plan Width": 48,
	...extra,
});

export const POSTGRES_EXPLAIN_FIXTURES: ExplainFixture[] = [
	{
		id: "postgres-estimated",
		database: "postgresql",
		category: "estimated",
		json: pg({ Plan: scan() }),
	},
	{
		id: "postgres-analyze",
		database: "postgresql",
		category: "analyze",
		json: pg({
			"Planning Time": 0.4,
			"Execution Time": 2.1,
			Plan: scan({ "Actual Rows": 92, "Actual Loops": 1 }),
		}),
	},
	{
		id: "postgres-buffers",
		database: "postgresql",
		category: "buffers",
		json: pg({
			Plan: scan({ "Shared Hit Blocks": 12, "Shared Read Blocks": 2 }),
		}),
	},
	{
		id: "postgres-verbose-settings-wal",
		database: "postgresql",
		category: "verbose-settings-wal",
		json: pg({
			Settings: { work_mem: "16MB" },
			Plan: scan({
				Alias: "u",
				Schema: "public",
				Output: ["u.id", "u.email"],
				"WAL Records": 3,
				"WAL Bytes": 240,
			}),
		}),
	},
	{
		id: "postgres-cte",
		database: "postgresql",
		category: "cte",
		json: pg({
			Plan: {
				"Node Type": "CTE Scan",
				"CTE Name": "active_users",
				"Plan Rows": 25,
				Plans: [scan({ "Parent Relationship": "InitPlan" })],
			},
		}),
	},
	{
		id: "postgres-subplan",
		database: "postgresql",
		category: "subquery-subplan",
		json: pg({
			Plan: scan({
				Filter: "(hashed SubPlan 1)",
				Plans: [
					{
						"Node Type": "Aggregate",
						"Subplan Name": "SubPlan 1",
						"Plan Rows": 1,
						Plans: [scan({ "Relation Name": "orders" })],
					},
				],
			}),
		}),
	},
	{
		id: "postgres-partition-append",
		database: "postgresql",
		category: "partitioned-append",
		json: pg({
			Plan: {
				"Node Type": "Append",
				"Plan Rows": 200,
				Plans: [
					scan({ "Relation Name": "events_2025" }),
					scan({ "Relation Name": "events_2026" }),
				],
			},
		}),
	},
	{
		id: "postgres-union-append",
		database: "postgresql",
		category: "union-append",
		json: pg({
			Plan: {
				"Node Type": "Append",
				"Plan Rows": 2,
				Plans: [
					{ "Node Type": "Result", "Plan Rows": 1 },
					{ "Node Type": "Result", "Plan Rows": 1 },
				],
			},
		}),
	},
	{
		id: "postgres-deep-plan",
		database: "postgresql",
		category: "deep",
		json: pg({
			Plan: {
				"Node Type": "Nested Loop",
				"Plan Rows": 8,
				Plans: [
					{
						"Node Type": "Hash Join",
						"Plan Rows": 8,
						Plans: [
							scan({ "Relation Name": "accounts" }),
							{
								"Node Type": "Hash",
								Plans: [scan({ "Relation Name": "profiles" })],
							},
						],
					},
					scan({ "Relation Name": "orders" }),
				],
			},
		}),
	},
	{
		id: "postgres-wide-plan",
		database: "postgresql",
		category: "wide",
		json: pg({
			Plan: {
				"Node Type": "Merge Append",
				"Plan Rows": 300,
				Plans: [
					scan({ "Relation Name": "shard_a" }),
					scan({ "Relation Name": "shard_b" }),
					scan({ "Relation Name": "shard_c" }),
					scan({ "Relation Name": "shard_d" }),
				],
			},
		}),
	},
];

export const MYSQL_EXPLAIN_FIXTURES: ExplainFixture[] = [
	{
		id: "mysql-80-format-json",
		database: "mysql",
		category: "mysql-8.0",
		json: mysql({
			select_id: 1,
			cost_info: { query_cost: "2.10" },
			table: {
				table_name: "users",
				access_type: "ALL",
				rows_examined_per_scan: 120,
				rows_produced_per_join: 120,
				filtered: "100.00",
			},
		}),
	},
	{
		id: "mysql-84-format-json",
		database: "mysql",
		category: "mysql-8.4",
		json: mysql({
			select_id: 1,
			cost_info: { query_cost: "1.10" },
			table: {
				table_name: "customers",
				access_type: "ref",
				possible_keys: ["customers_email_idx"],
				key: "customers_email_idx",
				used_key_parts: ["email"],
				ref: ["const"],
				rows_examined_per_scan: 1,
			},
		}),
	},
	{
		id: "mysql-nested-loop",
		database: "mysql",
		category: "nested-loop",
		json: mysql({
			select_id: 1,
			nested_loop: [
				{ table: { table_name: "orders", access_type: "range" } },
				{ table: { table_name: "customers", access_type: "eq_ref" } },
			],
		}),
	},
	{
		id: "mysql-filesort",
		database: "mysql",
		category: "ordering-filesort",
		json: mysql({
			select_id: 1,
			ordering_operation: {
				using_filesort: true,
				table: { table_name: "events", access_type: "ALL" },
			},
		}),
	},
	{
		id: "mysql-temporary-table",
		database: "mysql",
		category: "grouping-temporary",
		json: mysql({
			select_id: 1,
			grouping_operation: {
				using_temporary_table: true,
				table: { table_name: "line_items", access_type: "index" },
			},
		}),
	},
	{
		id: "mysql-materialized-subquery",
		database: "mysql",
		category: "materialized-subquery",
		json: mysql({
			select_id: 1,
			table: {
				table_name: "orders",
				access_type: "ALL",
				materialized_from_subquery: {
					query_block: {
						select_id: 2,
						table: { table_name: "vip_customers", access_type: "ALL" },
					},
				},
			},
		}),
	},
	{
		id: "mysql-union-result",
		database: "mysql",
		category: "union-result",
		json: mysql({
			select_id: 1,
			union_result: {
				query_specifications: [
					{ query_block: { select_id: 1, table: { table_name: "a" } } },
					{ query_block: { select_id: 2, table: { table_name: "b" } } },
				],
			},
		}),
	},
	{
		id: "mysql-client-explain-wrapper",
		database: "mysql",
		category: "client-wrapper",
		json: json([
			{
				EXPLAIN: json({
					query_block: {
						select_id: 1,
						table: { table_name: "audit_log", access_type: "ALL" },
					},
				}),
			},
		]),
	},
];

export const EXPLAIN_FIXTURES = [
	...POSTGRES_EXPLAIN_FIXTURES,
	...MYSQL_EXPLAIN_FIXTURES,
];
