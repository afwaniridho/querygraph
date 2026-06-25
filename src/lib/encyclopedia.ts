import type { Dialect } from "#/lib/dialect";

export interface ClauseEntry {
	heading: string;
	summary: string;
	docs: string;
}

const PG = "https://www.postgresql.org/docs/current";
const MY = "https://dev.mysql.com/doc/refman/8.0/en";

const postgres: Record<string, ClauseEntry> = {
	table: {
		heading: "FROM — Row Source",
		summary:
			"Names the table (or derived source) the query reads from. Every other step works on the rows this source produces, so it sits at the very top of the pipeline.",
		docs: `${PG}/sql-select.html#SQL-FROM`,
	},
	insert_target: {
		heading: "Target Table",
		summary:
			"The table that will receive new rows. The pipeline feeds finished rows into this destination.",
		docs: `${PG}/sql-insert.html`,
	},
	join: {
		heading: "JOIN — Combine Sources",
		summary:
			"Stitches two row sources together on a matching rule. INNER keeps only matches; LEFT/RIGHT/FULL keep unmatched rows from one or both sides as NULLs.",
		docs: `${PG}/queries-table-expressions.html#QUERIES-JOIN`,
	},
	where: {
		heading: "WHERE — Row Filter",
		summary:
			"Tests each individual row against a condition and drops the ones that fail. It runs before any grouping, so it cannot see aggregate totals. PostgreSQL compares strings case-sensitively.",
		docs: `${PG}/sql-select.html#SQL-WHERE`,
	},
	having: {
		heading: "HAVING — Group Filter",
		summary:
			"Like WHERE, but it runs after GROUP BY and tests whole groups. With no GROUP BY the entire result is one group, so HAVING then gates the whole query.",
		docs: `${PG}/sql-select.html#SQL-HAVING`,
	},
	select: {
		heading: "SELECT — Projection",
		summary:
			"Decides which columns and computed expressions appear in the output, and what they are named. Anything not listed here is discarded.",
		docs: `${PG}/sql-select.html#SQL-SELECT-LIST`,
	},
	distinct_on: {
		heading: "DISTINCT ON — First Per Key",
		summary:
			"A PostgreSQL extension that keeps the first row for each distinct value of the listed expressions. Pair it with ORDER BY to control which row survives.",
		docs: `${PG}/sql-select.html#SQL-DISTINCT`,
	},
	groupby: {
		heading: "GROUP BY — Bucketing",
		summary:
			"Folds rows that share the same key values into a single group. PostgreSQL requires every non-aggregated SELECT column to appear in this list.",
		docs: `${PG}/sql-select.html#SQL-GROUPBY`,
	},
	orderby: {
		heading: "ORDER BY — Sorting",
		summary:
			"Arranges the final rows by one or more keys, ascending or descending. Without it the database makes no promise about row order.",
		docs: `${PG}/sql-select.html#SQL-ORDERBY`,
	},
	limit: {
		heading: "LIMIT — Row Cap",
		summary:
			"Caps how many rows leave the query. Paired with OFFSET it powers pagination; paired with ORDER BY it powers top-N lookups.",
		docs: `${PG}/sql-select.html#SQL-LIMIT`,
	},
	cte: {
		heading: "WITH — Common Table Expression",
		summary:
			"Defines a named, temporary result set that the main query can reference like a table. RECURSIVE variants can feed their own output back in to walk hierarchies.",
		docs: `${PG}/queries-with.html`,
	},
	union: {
		heading: "Set Operation",
		summary:
			"Stacks the rows of two queries into one result. UNION removes duplicate rows; UNION ALL keeps every row. Both sides must share the same column shape.",
		docs: `${PG}/queries-union.html`,
	},
	values: {
		heading: "VALUES — Literal Rows",
		summary:
			"Supplies hand-written rows of constant data. Most often seen inside INSERT, but it can also stand in as an inline table.",
		docs: `${PG}/sql-values.html`,
	},
	insert: {
		heading: "INSERT — Write Rows",
		summary:
			"Adds new rows to a table, sourced either from a VALUES list or from the result of a query.",
		docs: `${PG}/sql-insert.html`,
	},
	on_conflict: {
		heading: "ON CONFLICT — Targeted Upsert",
		summary:
			"PostgreSQL's upsert. It needs an explicit conflict target (a column or constraint); on a clash there it can DO NOTHING or DO UPDATE the existing row.",
		docs: `${PG}/sql-insert.html#SQL-ON-CONFLICT`,
	},
	update: {
		heading: "UPDATE — Modify Rows",
		summary:
			"Changes column values on existing rows. The attached filter decides which rows are touched; with no filter, every row changes.",
		docs: `${PG}/sql-update.html`,
	},
	delete: {
		heading: "DELETE — Remove Rows",
		summary:
			"Removes rows from a table. The filter limits the blast radius; without one, the whole table is emptied.",
		docs: `${PG}/sql-delete.html`,
	},
	set: {
		heading: "SET — Assignments",
		summary:
			"Inside UPDATE, lists which columns get new values and what those values are. Expressions may reference the row's current contents.",
		docs: `${PG}/sql-update.html`,
	},
	returning: {
		heading: "RETURNING — Echo Rows",
		summary:
			"Hands back the rows an INSERT, UPDATE or DELETE just touched, so you skip a follow-up SELECT. This is a PostgreSQL feature; MySQL 8.0 has no equivalent.",
		docs: `${PG}/dml-returning.html`,
	},
	create: {
		heading: "CREATE TABLE — Define Schema",
		summary:
			"Declares a brand-new table: its columns, their types, and any constraints. PostgreSQL has a true BOOLEAN type and uses SERIAL/IDENTITY for auto-numbering.",
		docs: `${PG}/sql-createtable.html`,
	},
	column: {
		heading: "Column Definition",
		summary:
			"One column inside a table definition: a name, a data type, and optional rules such as NOT NULL, DEFAULT or PRIMARY KEY. Auto-numbering uses SERIAL or GENERATED AS IDENTITY.",
		docs: `${PG}/sql-createtable.html`,
	},
	operation: {
		heading: "SQL Statement",
		summary:
			"A general statement that shapes schema or data. Check the PostgreSQL manual for the exact behaviour of this command.",
		docs: `${PG}/sql-commands.html`,
	},
};

const mysql: Record<string, ClauseEntry> = {
	table: {
		heading: "FROM — Row Source",
		summary:
			"Names the table the query reads from. In MySQL, identifiers may be wrapped in backticks (`name`) while strings use single (or double) quotes.",
		docs: `${MY}/select.html`,
	},
	insert_target: {
		heading: "Target Table",
		summary:
			"The table that will receive new rows. The pipeline feeds finished rows into this destination.",
		docs: `${MY}/insert.html`,
	},
	join: {
		heading: "JOIN — Combine Sources",
		summary:
			"Stitches two row sources on a matching rule. INNER keeps only matches; LEFT/RIGHT keep unmatched rows as NULLs. MySQL has no FULL OUTER JOIN.",
		docs: `${MY}/join.html`,
	},
	straight_join: {
		heading: "STRAIGHT_JOIN — Forced Order",
		summary:
			"A MySQL join that forces the optimizer to read the left table before the right, in the order written. Reach for it only when MySQL's join order is wrong.",
		docs: `${MY}/join.html`,
	},
	where: {
		heading: "WHERE — Row Filter",
		summary:
			"Tests each row and drops the ones that fail, before any grouping. MySQL compares VARCHAR case-insensitively by default — the column's collation decides.",
		docs: `${MY}/where-optimization.html`,
	},
	having: {
		heading: "HAVING — Group Filter",
		summary:
			"Runs after GROUP BY and tests whole groups. With no GROUP BY the entire result is a single group, so HAVING then gates the whole query.",
		docs: `${MY}/group-by-modifiers.html`,
	},
	select: {
		heading: "SELECT — Projection",
		summary:
			"Decides which columns and computed expressions appear in the output, and what they are named. Anything not listed here is discarded.",
		docs: `${MY}/select.html`,
	},
	distinct_on: {
		heading: "DISTINCT — Drop Duplicates",
		summary:
			"Removes duplicate rows from the result. MySQL has no DISTINCT ON; emulate per-key picks with GROUP BY or a window function.",
		docs: `${MY}/select.html`,
	},
	groupby: {
		heading: "GROUP BY — Bucketing",
		summary:
			"Folds rows sharing the same key into one group. MySQL 8.0 defaults to ONLY_FULL_GROUP_BY; without it, non-grouped columns return an arbitrary value.",
		docs: `${MY}/group-by-handling.html`,
	},
	orderby: {
		heading: "ORDER BY — Sorting",
		summary:
			"Arranges the final rows by one or more keys, ascending or descending. Without it MySQL makes no promise about row order.",
		docs: `${MY}/order-by-optimization.html`,
	},
	limit: {
		heading: "LIMIT — Row Cap",
		summary:
			"Caps how many rows leave the query. MySQL's LIMIT a, b is shorthand for LIMIT b OFFSET a — the first number skips, the second caps.",
		docs: `${MY}/limit-optimization.html`,
	},
	index_hint: {
		heading: "Index Hint",
		summary:
			"USE INDEX suggests, FORCE INDEX insists, and IGNORE INDEX forbids. All are advisory nudges to MySQL's optimizer, not guarantees.",
		docs: `${MY}/index-hints.html`,
	},
	cte: {
		heading: "WITH — Common Table Expression",
		summary:
			"A named, temporary result set the main query can reference like a table. WITH RECURSIVE walks hierarchies by feeding its own output back in.",
		docs: `${MY}/with.html`,
	},
	union: {
		heading: "Set Operation",
		summary:
			"Stacks the rows of two queries into one. UNION removes duplicate rows; UNION ALL keeps every row. Both sides must share the same column shape.",
		docs: `${MY}/union.html`,
	},
	values: {
		heading: "VALUES — Literal Rows",
		summary:
			"Supplies hand-written rows of constant data, most often as the source of an INSERT.",
		docs: `${MY}/insert.html`,
	},
	insert: {
		heading: "INSERT — Write Rows",
		summary:
			"Adds new rows to a table, sourced from a VALUES list or a query result.",
		docs: `${MY}/insert.html`,
	},
	insert_ignore: {
		heading: "INSERT IGNORE — Skip Errors",
		summary:
			"Turns errors that would abort the insert — including duplicate-key violations — into warnings, silently skipping the offending rows.",
		docs: `${MY}/insert.html`,
	},
	replace: {
		heading: "REPLACE — Delete then Insert",
		summary:
			"Not an upsert. On a unique-key conflict it DELETEs the existing row (firing ON DELETE cascades and triggers) then INSERTs a fresh one.",
		docs: `${MY}/replace.html`,
	},
	on_duplicate_key: {
		heading: "ON DUPLICATE KEY UPDATE",
		summary:
			"MySQL's upsert. It fires on a conflict with ANY unique or primary key — no target needed — and updates the matched row instead of inserting.",
		docs: `${MY}/insert-on-duplicate.html`,
	},
	update: {
		heading: "UPDATE — Modify Rows",
		summary:
			"Changes column values on existing rows. The attached filter decides which rows are touched; with no filter, every row changes.",
		docs: `${MY}/update.html`,
	},
	multi_table_update: {
		heading: "Multi-Table UPDATE",
		summary:
			"Joins several tables and rewrites columns across them in one statement. Each target row is updated at most once.",
		docs: `${MY}/update.html`,
	},
	delete: {
		heading: "DELETE — Remove Rows",
		summary:
			"Removes rows from a table. The filter limits the blast radius; without one, the whole table is emptied.",
		docs: `${MY}/delete.html`,
	},
	multi_table_delete: {
		heading: "Multi-Table DELETE",
		summary:
			"Removes rows from one or more tables based on a join. Only the tables named before FROM lose rows.",
		docs: `${MY}/delete.html`,
	},
	set: {
		heading: "SET — Assignments",
		summary:
			"Inside UPDATE, lists which columns get new values and what those values are. Expressions may reference the row's current contents.",
		docs: `${MY}/update.html`,
	},
	create: {
		heading: "CREATE TABLE — Define Schema",
		summary:
			"Declares a new table. MySQL maps BOOL to TINYINT(1), auto-numbers with AUTO_INCREMENT, and carries ENGINE, CHARSET, and COLLATE options.",
		docs: `${MY}/create-table.html`,
	},
	column: {
		heading: "Column Definition",
		summary:
			"One column: a name, a data type, and optional rules. AUTO_INCREMENT supplies the next id; BOOL is stored as TINYINT(1); a UNIQUE column still allows multiple NULLs.",
		docs: `${MY}/create-table.html`,
	},
	operation: {
		heading: "SQL Statement",
		summary:
			"A general statement that shapes schema or data. Check the MySQL manual for the exact behaviour of this command.",
		docs: `${MY}/sql-statements.html`,
	},
};

const tables: Record<Dialect, Record<string, ClauseEntry>> = {
	postgres,
	mysql,
};

export function lookupClause(kind: string, dialect: Dialect): ClauseEntry {
	const table = tables[dialect];
	return table[kind] ?? table.operation;
}
