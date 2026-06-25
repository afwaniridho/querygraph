import type { AccessPathInfo } from "#/lib/access-path";
import type { Dialect } from "#/lib/dialect";

/** One-line summary shown on each node card and used for layout height. */
export function plainEnglish(
	kind: string,
	label: string,
	dialect: Dialect,
	access?: AccessPathInfo,
): string {
	switch (kind) {
		case "table": {
			if (label === "(no source)") return "Runs without reading any table.";
			if (label.startsWith("subquery"))
				return "Pulls its rows from an inline subquery.";
			if (access) return accessAwareTableProse(label, access);
			return `Reads every row from ${label}.`;
		}
		case "insert_target":
			return "The table that receives the new rows.";
		case "where":
			return `Keeps rows where ${label.replace(/^WHERE\s+/i, "")}.`;
		case "having":
			return `Keeps groups where ${label.replace(/^HAVING\s+/i, "")}.`;
		case "join": {
			if (label.includes("CROSS"))
				return "Pairs every row with every other row.";
			if (label.includes("NATURAL"))
				return "Joins on all identically-named columns.";
			const on = label.match(/ON\s+(.+)/i);
			const kindLabel = label.match(/^(\w+\s+JOIN)/i)?.[1] ?? "JOIN";
			return on ? `${kindLabel} on ${on[1]}.` : "Joins another source.";
		}
		case "straight_join":
			return "Forces the left table to be read first, in written order.";
		case "select":
			return "Shapes the output columns.";
		case "distinct_on":
			return dialect === "postgres"
				? "Keeps the first row per distinct key expression."
				: "Drops duplicate rows from the result.";
		case "groupby":
			return `Buckets rows by ${label.replace(/^GROUP BY\s+/i, "")}.`;
		case "orderby":
			return `Sorts the result by ${label.replace(/^ORDER BY\s+/i, "")}.`;
		case "limit":
			return `Returns at most ${label.replace(/^LIMIT\s+/i, "")} rows.`;
		case "index_hint":
			return `Steers the planner: ${label}.`;
		case "cte": {
			const name = label.replace(/^(CTE|RECURSIVE):\s*/i, "");
			return label.startsWith("RECURSIVE")
				? "A looping result set: it runs once, then feeds its own output back in until nothing new appears."
				: `A temporary result set named ${name}.`;
		}
		case "union":
			return label.includes("ALL")
				? "Stacks both result sets, duplicates and all."
				: "Merges both result sets, dropping duplicates.";
		case "delete":
			return `Removes matched rows from ${label.replace(/^DELETE FROM\s+/i, "")}.`;
		case "multi_table_delete":
			return `Removes matched rows from ${label.replace(/^DELETE\s+/i, "")}.`;
		case "insert":
			return "Writes the prepared rows into the target.";
		case "insert_ignore":
			return "Writes new rows, silently skipping ones that would violate a key.";
		case "replace":
			return "Deletes any conflicting row, then inserts the new one.";
		case "on_duplicate_key":
			return `On any unique conflict, updates instead: ${label.replace(/^ON DUPLICATE KEY UPDATE\s+/i, "")}.`;
		case "on_conflict":
			return label.includes("DO NOTHING")
				? "On a conflict at the named target, skips the row."
				: "On a conflict at the named target, updates the existing row.";
		case "update":
			return `Rewrites matched rows in ${label.replace(/^UPDATE\s+/i, "")}.`;
		case "multi_table_update":
			return `Rewrites matched rows across ${label.replace(/^UPDATE\s+/i, "")}.`;
		case "values":
			return "Supplies literal rows of data.";
		case "set":
			return `Assigns ${label.replace(/^SET\s+/i, "")}.`;
		case "returning":
			return `Echoes ${label.replace(/^RETURNING\s+/i, "")} from changed rows.`;
		case "create":
			return `Defines a new table named ${label.replace(/^CREATE TABLE\s+/i, "")}.`;
		case "column":
			return `Defines the ${label.trim()} column.`;
		default:
			return `Performs a ${label || kind} step.`;
	}
}

/**
 * Access-aware one-line prose for a table/source node. Used only when the
 * analyzer has produced an estimated access method from the DDL; otherwise the
 * generic "Reads every row" wording is kept to preserve schemaless behavior.
 */
function accessAwareTableProse(label: string, access: AccessPathInfo): string {
	switch (access.method) {
		case "pk_lookup":
			return `Reads at most one row from ${label} using the primary key.`;
		case "unique_lookup":
			return `Reads at most one row from ${label} using a unique index.`;
		case "index_seek":
			return `Reads matching rows from ${label} using an index.`;
		case "index_range":
			return `Reads a matching index range from ${label}.`;
		case "covering":
			return `Answers from an index on ${label} without reading the table rows.`;
		default:
			return `Reads every row from ${label}.`;
	}
}

/** Long-form, dialect-aware explanation shown in the details panel. */
export function detailedContext(
	kind: string,
	label: string,
	dialect: Dialect,
	access?: AccessPathInfo,
): string {
	const pg = dialect === "postgres";
	switch (kind) {
		case "table": {
			if (label === "(no source)")
				return "There is no table here. The query manufactures its rows rather than reading them from storage.";
			if (label.startsWith("subquery"))
				return "This source is a subquery — a complete query nested in the FROM clause that behaves like a throwaway table for the rows above it.";
			const name = label.replace(/\s*\(.*\)$/, "").trim();
			const quoting = pg
				? "In PostgreSQL, double quotes mark an identifier (`\"id\"`) and single quotes mark a string (`'x'`)."
				: "In MySQL, backticks mark an identifier (`` `id` ``) while quotes mark a string (`'x'` or `\"x\"`).";
			if (access && access.method !== "full_scan") {
				return `This is where data enters the pipeline. Because your DDL exposes an index usable by this query, the estimated access path on \`${name}\` starts from matching candidate rows rather than a full table scan. The WHERE step still represents the logical predicate that rows must satisfy. ${quoting}`;
			}
			return `This is where data enters the pipeline: every row of \`${name}\` is loaded, unfiltered, ready for the steps that follow. ${quoting}`;
		}
		case "where": {
			const cmp = pg
				? "PostgreSQL compares strings case-sensitively by default."
				: "MySQL compares `VARCHAR` case-insensitively by default — the column's collation, not the value, decides.";
			return `Each row is tested against \`${label.replace(/^WHERE\s+/i, "")}\`. Rows that fail never reach the next step. ${cmp}`;
		}
		case "having":
			return `After grouping, whole groups are tested against \`${label.replace(/^HAVING\s+/i, "")}\`. Groups that fail are dropped entirely. With no GROUP BY, the whole result is treated as a single group.`;
		case "join": {
			if (label.includes("CROSS"))
				return "Every row on the left is paired with every row on the right — a Cartesian product. The output can grow very large, very fast.";
			const on = label.match(/ON\s+(.+)/i);
			const kindLabel = label.match(/^(\w+\s+JOIN)/i)?.[1] ?? "JOIN";
			const cmp = pg
				? ""
				: " MySQL string comparisons in the ON clause follow the column collation, so they are usually case-insensitive.";
			return on
				? `This \`${kindLabel}\` lines up rows from both sides where \`${on[1]}\`. Unmatched rows are handled according to the join type.${cmp}`
				: "Two sources are combined on a matching rule.";
		}
		case "straight_join":
			return "`STRAIGHT_JOIN` is a MySQL hint that forces the optimizer to read the left table before the right, in the order written. Use it only when MySQL's chosen join order is demonstrably wrong.";
		case "select": {
			const cols = label.replace(/^SELECT\s+/i, "");
			if (cols === "*")
				return "Every available column flows straight through, untouched.";
			return `The output is narrowed to \`${cols}\`. Columns left off this list are dropped from the result.`;
		}
		case "distinct_on":
			return pg
				? "`DISTINCT ON` keeps the first row for each distinct value of the listed expressions — pair it with ORDER BY to control which row wins."
				: "`DISTINCT` removes duplicate rows from the result. MySQL has no `DISTINCT ON`; emulate per-key picks with GROUP BY or window functions.";
		case "groupby": {
			const note = pg
				? "PostgreSQL requires every non-aggregated SELECT column to appear here."
				: "MySQL 8.0 enables `ONLY_FULL_GROUP_BY` by default, so non-aggregated columns must be functionally dependent on the grouping; without that mode it would pick an arbitrary value.";
			return `Rows sharing the same \`${label.replace(/^GROUP BY\s+/i, "")}\` collapse into one. Aggregates like sum and count then run per bucket. ${note}`;
		}
		case "orderby":
			return `The whole result is sorted by \`${label.replace(/^ORDER BY\s+/i, "")}\`. Skip this and row order is anyone's guess.`;
		case "limit": {
			const raw = label.replace(/^LIMIT\s+/i, "");
			const note = pg
				? "Pair it with OFFSET to skip rows for pagination."
				: "MySQL's `LIMIT a, b` is shorthand for `LIMIT b OFFSET a` — the first number skips, the second caps.";
			return `Output is capped at \`${raw}\` rows — the backbone of pagination and top-N queries. ${note}`;
		}
		case "index_hint":
			return `\`${label}\` is a MySQL index hint. \`USE INDEX\` suggests, \`FORCE INDEX\` insists, and \`IGNORE INDEX\` forbids — all advisory nudges to the optimizer, not guarantees.`;
		case "cte": {
			const name = label.replace(/^(CTE|RECURSIVE):\s*/i, "").trim();
			return label.startsWith("RECURSIVE")
				? `\`${name}\` is a recursive CTE: a base query seeds it, then the recursive arm runs again and again until it stops producing rows.`
				: `\`${name}\` is a named, reusable result set the main query can lean on like a table.`;
		}
		case "union":
			return label.includes("ALL")
				? "Both result sets are stacked into one, keeping every duplicate. The two sides must agree on column count."
				: "Both result sets merge into one and duplicates vanish. The two sides must agree on column count.";
		case "insert":
			return "The prepared rows are committed into the target table as new records.";
		case "insert_ignore":
			return "`INSERT IGNORE` turns errors that would abort the insert — including duplicate-key violations — into warnings, silently skipping the offending rows. Use it knowingly: it also masks other recoverable errors.";
		case "replace":
			return "`REPLACE INTO` is not an upsert. On a unique-key conflict it DELETEs the existing row (firing ON DELETE cascades and triggers) and then INSERTs a fresh one — the old row's other columns are lost.";
		case "on_duplicate_key":
			return `\`ON DUPLICATE KEY UPDATE\` fires on a conflict with ANY unique or primary key, without naming a target. The matched row is updated with \`${label.replace(/^ON DUPLICATE KEY UPDATE\s+/i, "")}\` instead of inserting.`;
		case "on_conflict":
			return label.includes("DO NOTHING")
				? "PostgreSQL's `ON CONFLICT … DO NOTHING` needs a specific conflict target (a column or constraint). On a clash there, the row is skipped rather than erroring."
				: "PostgreSQL's `ON CONFLICT … DO UPDATE` needs a specific conflict target. On a clash there, the existing row is updated — a true, targeted upsert.";
		case "update":
			return `Existing rows in \`${label.replace(/^UPDATE\s+/i, "")}\` are rewritten — but only the ones that survived the filters above.`;
		case "multi_table_update":
			return `This MySQL multi-table UPDATE joins \`${label.replace(/^UPDATE\s+/i, "")}\` and rewrites columns across the joined tables in one statement. Each target row is updated at most once.`;
		case "delete":
			return `Matched rows are removed from \`${label.replace(/^DELETE FROM\s+/i, "")}\`. Mind the filter: without one, the table empties.`;
		case "multi_table_delete":
			return `This MySQL multi-table DELETE removes rows from \`${label.replace(/^DELETE\s+/i, "")}\` based on a join. Only the tables named before FROM lose rows.`;
		case "set":
			return `New column values are assigned: \`${label.replace(/^SET\s+/i, "")}\`.`;
		case "returning":
			return `After the write, \`${label.replace(/^RETURNING\s+/i, "")}\` from the affected rows is handed straight back. RETURNING is a PostgreSQL feature; MySQL 8.0 has no equivalent.`;
		case "values":
			return "A block of literal, hand-written rows used as input to the step below.";
		case "create": {
			const note = pg
				? "PostgreSQL has a real `BOOLEAN` type and uses `SERIAL`/`IDENTITY` for auto-numbering."
				: "MySQL maps `BOOL` to `TINYINT(1)`, auto-numbers with `AUTO_INCREMENT`, and carries `ENGINE`, `CHARSET`, and `COLLATE` options. A `UNIQUE` constraint still permits multiple NULLs.";
			return `A fresh table is declared here, named \`${label.replace(/^CREATE TABLE\s+/i, "")}\`, along with its columns and constraints. ${note}`;
		}
		case "column": {
			const note = pg
				? "Use `SERIAL` or `GENERATED … AS IDENTITY` for auto-incrementing keys; `BOOLEAN` is a first-class type."
				: "`AUTO_INCREMENT` supplies the next id; `BOOL` is stored as `TINYINT(1)`.";
			return `Defines the \`${label.trim()}\` column inside the table. ${note}`;
		}
		default:
			return `Carries out a \`${label || kind}\` operation.`;
	}
}
