import type { Dialect } from "#/lib/dialect";
import type { HealthRuleId } from "#/lib/query-health/types";

export type ExampleCategory =
	| "Foundations"
	| "Join safety"
	| "Determinism"
	| "Write safety"
	| "Indexing"
	| "Aggregation";

export interface SqlExample {
	id: string;
	title: string;
	objective: string;
	category: ExampleCategory;
	difficulty: "Beginner" | "Intermediate" | "Advanced";
	dialect: Dialect;
	sql: string;
	ddl?: string;
	expectedFindingIds: HealthRuleId[];
}

export const SQL_EXAMPLES: readonly SqlExample[] = [
	{
		id: "basic-join-filter",
		title: "Recent paid orders",
		objective:
			"Trace a basic join and selective filter through the logical pipeline.",
		category: "Foundations",
		difficulty: "Beginner",
		dialect: "postgres",
		sql: "SELECT o.id, c.email\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.status = 'paid';",
		expectedFindingIds: [],
	},
	{
		id: "left-join-filter",
		title: "Missing profiles disappear",
		objective:
			"See how a WHERE condition can make a LEFT JOIN behave like an INNER JOIN.",
		category: "Join safety",
		difficulty: "Intermediate",
		dialect: "postgres",
		sql: "SELECT u.id, p.display_name\nFROM users u\nLEFT JOIN profiles p ON p.user_id = u.id\nWHERE p.active = true;",
		expectedFindingIds: ["left-join-filtered-in-where"],
	},
	{
		id: "join-duplicates",
		title: "Orders repeated by line items",
		objective:
			"Explore a one-to-many join that can repeat order rows; cardinality is intentionally not guessed.",
		category: "Join safety",
		difficulty: "Intermediate",
		dialect: "mysql",
		sql: "SELECT o.id, o.created_at\nFROM orders o\nJOIN order_items i ON i.order_id = o.id;",
		expectedFindingIds: [],
	},
	{
		id: "limit-no-order",
		title: "Arbitrary recent customers",
		objective:
			"Understand why LIMIT alone does not define which rows are returned.",
		category: "Determinism",
		difficulty: "Beginner",
		dialect: "mysql",
		sql: "SELECT id, email FROM customers LIMIT 20;",
		expectedFindingIds: ["limit-without-order"],
	},
	{
		id: "select-star",
		title: "Over-fetching account data",
		objective:
			"Replace a broad projection with a stable, intentional column contract.",
		category: "Foundations",
		difficulty: "Beginner",
		dialect: "postgres",
		sql: "SELECT * FROM accounts WHERE status = 'active';",
		expectedFindingIds: ["select-star"],
	},
	{
		id: "cross-join-growth",
		title: "Every campaign × every region",
		objective: "Spot deliberate or accidental Cartesian row growth.",
		category: "Join safety",
		difficulty: "Beginner",
		dialect: "postgres",
		sql: "SELECT c.name, r.code\nFROM campaigns c\nCROSS JOIN regions r;",
		expectedFindingIds: ["cartesian-join"],
	},
	{
		id: "update-all-rows",
		title: "Global account update",
		objective: "Catch a write statement that has no row boundary.",
		category: "Write safety",
		difficulty: "Beginner",
		dialect: "mysql",
		sql: "UPDATE accounts SET trial_ends_at = CURRENT_DATE;",
		expectedFindingIds: ["update-without-where"],
	},
	{
		id: "delete-all-rows",
		title: "Delete the entire audit log",
		objective: "Catch an unscoped destructive statement before execution.",
		category: "Write safety",
		difficulty: "Beginner",
		dialect: "postgres",
		sql: "DELETE FROM audit_events;",
		expectedFindingIds: ["delete-without-where"],
	},
	{
		id: "function-indexed-column",
		title: "Case-insensitive email lookup",
		objective: "See why wrapping an indexed column changes index usability.",
		category: "Indexing",
		difficulty: "Advanced",
		dialect: "postgres",
		sql: "SELECT id FROM users WHERE LOWER(email) = 'ada@example.com';",
		ddl: "CREATE TABLE users (id int PRIMARY KEY, email text);\nCREATE INDEX users_email_idx ON users (email);",
		expectedFindingIds: ["indexed-column-expression", "estimated-full-scan"],
	},
	{
		id: "leading-like",
		title: "Substring product search",
		objective:
			"Understand why a leading wildcard cannot seek through a normal B-tree index.",
		category: "Indexing",
		difficulty: "Intermediate",
		dialect: "mysql",
		sql: "SELECT id, name FROM products WHERE name LIKE '%wireless%';",
		ddl: "CREATE TABLE products (id int PRIMARY KEY, name varchar(255), INDEX products_name_idx (name));",
		expectedFindingIds: ["leading-wildcard-like", "estimated-full-scan"],
	},
	{
		id: "composite-order",
		title: "Second column of a composite index",
		objective:
			"Explore why a composite B-tree normally needs its leading column constrained first.",
		category: "Indexing",
		difficulty: "Advanced",
		dialect: "postgres",
		sql: "SELECT id, created_at FROM events WHERE created_at >= '2026-01-01';",
		ddl: "CREATE TABLE events (id int PRIMARY KEY, tenant_id int, created_at timestamp);\nCREATE INDEX events_tenant_created_idx ON events (tenant_id, created_at);",
		expectedFindingIds: ["composite-index-prefix", "estimated-full-scan"],
	},
	{
		id: "group-by-risk",
		title: "Revenue by customer",
		objective:
			"Inspect aggregation shape without inventing cardinality warnings that schema metadata cannot prove.",
		category: "Aggregation",
		difficulty: "Intermediate",
		dialect: "mysql",
		sql: "SELECT customer_id, SUM(total) AS revenue\nFROM orders\nGROUP BY customer_id\nORDER BY revenue DESC;",
		expectedFindingIds: [],
	},
	{
		id: "null-equality",
		title: "NULL compared with equals",
		objective:
			"See why ordinary equality cannot test whether a value is unknown.",
		category: "Foundations",
		difficulty: "Beginner",
		dialect: "postgres",
		sql: "SELECT id, email FROM users WHERE deleted_at = NULL;",
		expectedFindingIds: ["null-comparison"],
	},
	{
		id: "not-in-null",
		title: "Exclusion list poisoned by NULL",
		objective:
			"Understand SQL three-valued logic in a NOT IN exclusion filter.",
		category: "Foundations",
		difficulty: "Intermediate",
		dialect: "mysql",
		sql: "SELECT id FROM products WHERE category_id NOT IN (3, 7, NULL);",
		expectedFindingIds: ["not-in-with-null"],
	},
	{
		id: "deep-offset",
		title: "Deep activity-feed page",
		objective:
			"Compare OFFSET pagination with a stable keyset pagination direction.",
		category: "Determinism",
		difficulty: "Intermediate",
		dialect: "postgres",
		sql: "SELECT id, created_at FROM events ORDER BY created_at, id LIMIT 50 OFFSET 50000;",
		expectedFindingIds: ["offset-pagination"],
	},
	{
		id: "mysql-loose-grouping",
		title: "Arbitrary status per customer",
		objective: "Find a projected value that is neither grouped nor aggregated.",
		category: "Aggregation",
		difficulty: "Intermediate",
		dialect: "mysql",
		sql: "SELECT customer_id, status, COUNT(*) AS orders\nFROM orders\nGROUP BY customer_id;",
		expectedFindingIds: ["non-grouped-select"],
	},
] as const;
