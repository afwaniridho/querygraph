export type Dialect = "postgres" | "mysql";

export const DIALECT_STORAGE_KEY = "querygraph:dialect";

export const DDL_STORAGE_KEY = "querygraph:ddl";

export const DIALECTS: { id: Dialect; label: string }[] = [
	{ id: "postgres", label: "PostgreSQL" },
	{ id: "mysql", label: "MySQL" },
];

export const DEFAULT_SQL: Record<Dialect, string> = {
	postgres: `SELECT
  c.name,
  count(o.id) AS orders,
  sum(o.total) AS lifetime_value
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.placed_at > '2024-01-01'
GROUP BY c.name
HAVING sum(o.total) > 500
ORDER BY lifetime_value DESC
LIMIT 10;`,
	mysql: `SELECT
  \`c\`.\`name\`,
  count(o.id) AS orders,
  sum(o.total) AS lifetime_value
FROM \`customers\` c
JOIN orders o ON o.customer_id = c.id
WHERE o.placed_at > '2024-01-01'
GROUP BY \`c\`.\`name\`
HAVING sum(o.total) > 500
ORDER BY lifetime_value DESC
LIMIT 5, 10;`,
};

export function isDialect(value: unknown): value is Dialect {
	return value === "postgres" || value === "mysql";
}

/**
 * Normalizes smart quotes, zero-width characters, and line endings without
 * altering meaningful offsets for typical ASCII SQL. The PostgreSQL-only
 * `RECURSIVE` strip lives in the PG adapter, not here, so MySQL keeps its
 * `WITH RECURSIVE` keyword intact.
 */
export function sanitize(raw: string): string {
	return raw
		.replace(/\uFEFF/g, "")
		.replace(/[\u200B-\u200D\u2060]/g, "")
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/\u2014/g, "--")
		.replace(/\u2013/g, "-")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.trim();
}

function errorText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	if (err && typeof err === "object" && "message" in err) {
		return String((err as { message: unknown }).message);
	}
	return "Could not parse this query.";
}

function postgresHint(raw: string, input: string): string | null {
	if (/\bWITH\b[\s\S]*?\b\w+\s*\([^)]+\)\s*\bAS\b/i.test(raw)) {
		return "Explicit CTE column lists like cte_name (a, b) aren't supported yet — alias the columns inside the SELECT instead.";
	}
	if (/\bNATURAL\s+JOIN\b/i.test(input)) {
		return "NATURAL JOIN isn't supported by the parser. Use an explicit JOIN … ON or USING clause.";
	}
	if (/^\s*(GRANT|REVOKE)\b/i.test(raw)) {
		return "Permission statements (GRANT / REVOKE) can't be visualized. Try a SELECT, INSERT, or CREATE instead.";
	}
	if (/^\s*(CREATE|DROP)\s+(ROLE|USER)\b/i.test(raw)) {
		return "Role and user admin commands can't be visualized. Try a table definition or a data query.";
	}
	if (/^\s*EXPLAIN\b/i.test(raw)) {
		return "QueryGraph maps the logic of raw SQL, not execution plans. Drop the EXPLAIN keyword and paste the query itself.";
	}
	if (/\bINTERSECT\b/i.test(input)) {
		return "INTERSECT isn't supported by the parser yet. Emulate it with `SELECT … WHERE EXISTS (SELECT … FROM other)`.";
	}
	if (/\bEXCEPT\b/i.test(input)) {
		return "EXCEPT isn't supported by the parser yet. Emulate it with `SELECT … WHERE NOT EXISTS (SELECT … FROM other)`.";
	}
	if (/\bLIMIT\s+ALL\b/i.test(input)) {
		return "`LIMIT ALL` isn't supported by the parser. It's equivalent to having no LIMIT — just drop the clause.";
	}
	if (/\bWINDOW\s+\w+\s+AS\s*\(/i.test(input)) {
		return "Named WINDOW clauses aren't supported by the parser. Inline the window definition inside each OVER (…) instead.";
	}
	if (/\bHAVING\b/i.test(input) && !/\bGROUP\s+BY\b/i.test(input)) {
		return "HAVING without GROUP BY isn't supported by the parser. Add a `GROUP BY` (even on a constant) or move the predicate into WHERE.";
	}
	return null;
}

function mysqlHint(raw: string, input: string): string | null {
	if (/\bFULL\s+(OUTER\s+)?JOIN\b/i.test(input)) {
		return "MySQL has no FULL OUTER JOIN. Emulate it with a LEFT JOIN UNION a RIGHT JOIN.";
	}
	if (/\bRETURNING\b/i.test(input)) {
		return "RETURNING isn't available in MySQL 8.0. Run a follow-up SELECT to read the changed rows.";
	}
	if (/^\s*(GRANT|REVOKE)\b/i.test(raw)) {
		return "Permission statements (GRANT / REVOKE) can't be visualized. Try a SELECT, INSERT, or CREATE instead.";
	}
	if (/^\s*EXPLAIN\b/i.test(raw)) {
		return "QueryGraph maps the logic of raw SQL, not execution plans. Drop the EXPLAIN keyword and paste the query itself.";
	}
	return null;
}

export function friendlyError(
	raw: string,
	input: string,
	err: unknown,
	dialect: Dialect,
): string {
	const hint =
		dialect === "postgres" ? postgresHint(raw, input) : mysqlHint(raw, input);
	if (hint) return hint;
	const msg = errorText(err);
	const firstLine = msg.split("\n").find((l) => l.trim()) ?? msg;
	return firstLine.length > 130 ? `${firstLine.slice(0, 127)}…` : firstLine;
}
