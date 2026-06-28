// biome-ignore-all lint/suspicious/noExplicitAny: both parser libraries expose
// different recursive AST shapes; runtime guards narrow every field we consume.
import type { Node } from "@xyflow/react";
import { Parser } from "node-sql-parser";
import { parse } from "pgsql-ast-parser";
import type { Dialect } from "#/lib/dialect";
import type { SourceSpan } from "#/lib/pipeline";
import type {
	HealthCategory,
	HealthConfidence,
	HealthContext,
	HealthEvidenceKind,
	HealthFinding,
	HealthRuleId,
	HealthSeverity,
} from "#/lib/query-health/types";
import type { SchemaModel } from "#/lib/schema/schema";
import { getTable, normalizeIdent } from "#/lib/schema/schema";

const mysqlParser = new Parser();
const BOTH: readonly Dialect[] = ["postgres", "mysql"];

export const HEALTH_RULE_CATALOG: Readonly<
	Record<
		HealthRuleId,
		{
			category: HealthCategory;
			confidence: HealthConfidence;
			evidenceKind: HealthEvidenceKind;
		}
	>
> = {
	"select-star": {
		category: "maintainability",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"limit-without-order": {
		category: "determinism",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"cartesian-join": {
		category: "performance",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"update-without-where": {
		category: "safety",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"delete-without-where": {
		category: "safety",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"leading-wildcard-like": {
		category: "performance",
		confidence: "high",
		evidenceKind: "heuristic",
	},
	"indexed-column-expression": {
		category: "performance",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"left-join-filtered-in-where": {
		category: "correctness",
		confidence: "high",
		evidenceKind: "query-structure",
	},
	"composite-index-prefix": {
		category: "performance",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"estimated-full-scan": {
		category: "performance",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"null-comparison": {
		category: "correctness",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"not-in-with-null": {
		category: "correctness",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"tautological-write-filter": {
		category: "safety",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"offset-pagination": {
		category: "performance",
		confidence: "high",
		evidenceKind: "query-structure",
	},
	"random-order": {
		category: "performance",
		confidence: "high",
		evidenceKind: "query-structure",
	},
	"redundant-distinct": {
		category: "maintainability",
		confidence: "high",
		evidenceKind: "query-structure",
	},
	"non-grouped-select": {
		category: "portability",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"not-null-is-null": {
		category: "correctness",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"limit-order-ties": {
		category: "determinism",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"join-may-duplicate": {
		category: "correctness",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"destructive-ddl": {
		category: "safety",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"insert-without-columns": {
		category: "maintainability",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
	"nullable-not-in-subquery": {
		category: "correctness",
		confidence: "estimate",
		evidenceKind: "schema",
	},
	"distinct-on-order": {
		category: "determinism",
		confidence: "definite",
		evidenceKind: "query-structure",
	},
};

function nodeOf(nodes: Node[], kind: string): Node | undefined {
	return nodes.find((node) => node.data?.kind === kind);
}

function spanOf(node: Node | undefined): SourceSpan | undefined {
	return node?.data?.loc as SourceSpan | undefined;
}

function keywordSpan(sql: string, text: string): SourceSpan | undefined {
	const index = sql.toUpperCase().indexOf(text.toUpperCase());
	return index < 0 ? undefined : { start: index, end: index + text.length };
}

function finding(
	context: HealthContext,
	ruleId: HealthRuleId,
	severity: HealthSeverity,
	title: string,
	evidence: string,
	explanation: string,
	remediation: string,
	kind?: string,
	extra?: Partial<HealthFinding>,
): HealthFinding {
	const node = kind ? nodeOf(context.nodes, kind) : undefined;
	const meta = HEALTH_RULE_CATALOG[ruleId];
	return {
		ruleId,
		severity,
		title,
		evidence,
		explanation,
		remediation,
		dialects: BOTH,
		...meta,
		nodeId: node?.id,
		sourceSpan: spanOf(node),
		...extra,
	};
}

function walk(
	value: unknown,
	visit: (node: Record<string, any>) => void,
): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) walk(item, visit);
		return;
	}
	const node = value as Record<string, any>;
	visit(node);
	for (const child of Object.values(node)) walk(child, visit);
}

function statements(sql: string, dialect: Dialect): Record<string, any>[] {
	if (dialect === "postgres") {
		return parse(
			sql.replace(/\bRECURSIVE\b/gi, (m) => " ".repeat(m.length)),
			{
				locationTracking: true,
			},
		) as Record<string, any>[];
	}
	const result = mysqlParser.astify(sql, { database: "mysql" });
	return (Array.isArray(result) ? result : [result]) as Record<string, any>[];
}

function reviewableBlocks(ast: Record<string, any>): Record<string, any>[] {
	const blocks: Record<string, any>[] = [];
	const seen = new Set<Record<string, any>>();
	walk(ast, (node) => {
		const type = String(node.type ?? "").toLowerCase();
		if (
			[
				"select",
				"insert",
				"update",
				"delete",
				"union",
				"union all",
				"truncate",
				"truncate table",
				"drop",
				"drop table",
			].includes(type) &&
			!seen.has(node)
		) {
			seen.add(node);
			blocks.push(node);
		}
	});
	return blocks;
}

function hasOrder(ast: Record<string, any>, dialect: Dialect): boolean {
	return dialect === "postgres"
		? Boolean(ast.orderBy?.length)
		: Boolean(ast.orderby?.length);
}

function hasLimit(ast: Record<string, any>): boolean {
	return Boolean(ast.limit);
}

function columnName(node: Record<string, any> | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === "ref") return node.name;
	if (node.type === "column_ref") {
		return typeof node.column === "string"
			? node.column
			: node.column?.expr?.value;
	}
	return undefined;
}

function tableQualifier(
	node: Record<string, any> | undefined,
): string | undefined {
	if (!node) return undefined;
	if (node.type === "ref") return node.table?.name;
	return typeof node.table === "string" ? node.table : node.table?.value;
}

function stringValue(node: Record<string, any>): string | undefined {
	return typeof node?.value === "string" ? node.value : undefined;
}

function isNull(node: Record<string, any> | undefined): boolean {
	return node?.type === "null" || node?.value === null;
}

function scalarValue(node: Record<string, any> | undefined): unknown {
	if (!node || columnName(node)) return undefined;
	if (["integer", "number", "string", "boolean"].includes(String(node.type))) {
		return node.value;
	}
	return undefined;
}

function isTautology(node: Record<string, any> | undefined): boolean {
	if (!node) return false;
	const op = String(node.op ?? node.operator ?? "").toUpperCase();
	const left = scalarValue(node.left);
	const right = scalarValue(node.right);
	return (
		(op === "=" && left !== undefined && left === right) ||
		(node.type === "boolean" && node.value === true)
	);
}

function listContainsNull(node: Record<string, any> | undefined): boolean {
	const values = node?.expressions ?? node?.value;
	return Array.isArray(values) && values.some((value) => isNull(value));
}

function functionName(node: Record<string, any> | undefined): string {
	if (!node) return "";
	if (typeof node.name === "string") return node.name.toLowerCase();
	if (typeof node.function?.name === "string")
		return node.function.name.toLowerCase();
	const parts = node.name?.name;
	if (Array.isArray(parts)) {
		return parts
			.map((part: any) => part?.value ?? "")
			.join(".")
			.toLowerCase();
	}
	return "";
}

function groupColumns(ast: Record<string, any>, dialect: Dialect): string[] {
	const values =
		dialect === "postgres"
			? ast.groupBy
			: (ast.groupby?.columns ?? ast.groupby);
	if (!Array.isArray(values)) return [];
	return values.map((value) => columnName(value)).filter(Boolean) as string[];
}

function orderColumns(ast: Record<string, any>, dialect: Dialect): string[] {
	const values = dialect === "postgres" ? ast.orderBy : ast.orderby;
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => columnName(dialect === "postgres" ? value.by : value.expr))
		.filter(Boolean) as string[];
}

function selectedBareColumns(ast: Record<string, any>): string[] {
	if (!Array.isArray(ast.columns)) return [];
	const out: string[] = [];
	for (const column of ast.columns) {
		const expr = column?.expr;
		const name = columnName(expr);
		if (name && name !== "*") out.push(name);
		else if (
			expr &&
			!["call", "aggr_func", "function"].includes(String(expr.type))
		) {
			walk(expr, (node) => {
				const nested = columnName(node);
				if (nested && nested !== "*") out.push(nested);
			});
		}
	}
	return out;
}

function hasUniqueKey(table: ReturnType<typeof getTable>, columns: string[]) {
	if (!table || columns.length === 0) return false;
	const normalized = columns.map(normalizeIdent);
	return table.indexes.some(
		(index) =>
			index.unique &&
			index.columns.length <= normalized.length &&
			index.columns.every(
				(column, position) => normalizeIdent(column) === normalized[position],
			),
	);
}

function hasUniqueColumnSet(
	table: ReturnType<typeof getTable>,
	columns: string[],
): boolean {
	if (!table || columns.length === 0) return false;
	const normalized = new Set(columns.map(normalizeIdent));
	return table.indexes.some(
		(index) =>
			index.unique &&
			index.columns.length === normalized.size &&
			index.columns.every((column) => normalized.has(normalizeIdent(column))),
	);
}

function isDirectRefForAlias(
	node: Record<string, any> | undefined,
	alias: string,
): boolean {
	return (
		Boolean(columnName(node)) &&
		normalizeIdent(tableQualifier(node) ?? "") === normalizeIdent(alias)
	);
}

function isNullRejectingForAlias(
	node: Record<string, any> | undefined,
	alias: string,
): boolean {
	if (!node) return false;
	const op = String(node.op ?? node.operator ?? "").toUpperCase();
	if (op === "AND") {
		return (
			isNullRejectingForAlias(node.left, alias) ||
			isNullRejectingForAlias(node.right, alias)
		);
	}
	if (op === "OR") {
		return (
			isNullRejectingForAlias(node.left, alias) &&
			isNullRejectingForAlias(node.right, alias)
		);
	}
	if (op === "IS NULL") return false;
	if (op === "IS NOT NULL") {
		return isDirectRefForAlias(node.operand ?? node.left, alias);
	}
	const rejectingOps = new Set([
		"=",
		"!=",
		"<>",
		">",
		"<",
		">=",
		"<=",
		"LIKE",
		"IN",
		"NOT IN",
		"BETWEEN",
	]);
	return (
		rejectingOps.has(op) &&
		(isDirectRefForAlias(node.left, alias) ||
			isDirectRefForAlias(node.right, alias))
	);
}

function tableNames(
	ast: Record<string, any>,
	dialect: Dialect,
): Map<string, string> {
	const result = new Map<string, string>();
	const sources = Array.isArray(ast.from) ? ast.from : [];
	for (const source of sources) {
		if (dialect === "postgres" && source.type === "table") {
			const name = source.name?.name;
			if (name) result.set(normalizeIdent(source.name?.alias ?? name), name);
		} else if (dialect === "mysql" && typeof source.table === "string") {
			result.set(normalizeIdent(source.as ?? source.table), source.table);
		}
	}
	return result;
}

function isIndexed(
	schema: SchemaModel | undefined,
	tables: Map<string, string>,
	column: string,
	qualifier?: string,
): boolean {
	if (!schema) return false;
	const candidates = qualifier
		? [tables.get(normalizeIdent(qualifier)) ?? qualifier]
		: [...tables.values()];
	return candidates.some((name) => {
		const table = getTable(schema, name);
		return table?.indexes.some((index) =>
			index.columns.some(
				(item) => normalizeIdent(item) === normalizeIdent(column),
			),
		);
	});
}

function evaluateStatement(
	context: HealthContext,
	ast: Record<string, any>,
): HealthFinding[] {
	const out: HealthFinding[] = [];
	const type = String(ast.type ?? "").toLowerCase();

	if (
		type === "truncate" ||
		type === "truncate table" ||
		type === "drop table" ||
		(type === "drop" && String(ast.keyword ?? "").toLowerCase() === "table")
	) {
		const operation = type.startsWith("truncate") ? "TRUNCATE" : "DROP TABLE";
		out.push(
			finding(
				context,
				"destructive-ddl",
				"danger",
				`${operation} removes data or schema`,
				`This statement performs ${operation}.`,
				operation === "TRUNCATE"
					? "TRUNCATE removes every row and commonly has different transaction, trigger, identity, and cascade behavior from DELETE."
					: "DROP TABLE removes the table definition and its stored data; dependent-object behavior is dialect and schema dependent.",
				"Verify the target, backups, dependencies, transaction behavior, and deployment environment before execution.",
				"operation",
				{ sourceSpan: keywordSpan(context.sql, operation.split(" ")[0]) },
			),
		);
	}

	if (
		type === "insert" &&
		(!Array.isArray(ast.columns) || ast.columns.length === 0)
	) {
		out.push(
			finding(
				context,
				"insert-without-columns",
				"warning",
				"INSERT relies on physical column order",
				"The INSERT statement omits an explicit target-column list.",
				"Values are coupled to the table's current column order, so compatible schema changes can silently redirect or break writes.",
				"Name every target column before VALUES or the SELECT source.",
				"insert",
			),
		);
	}

	if (
		type === "select" &&
		(!Array.isArray(ast.columns) ||
			ast.columns.some(
				(column: any) =>
					column === "*" ||
					column?.expr?.name === "*" ||
					column?.expr?.column === "*",
			))
	) {
		out.push(
			finding(
				context,
				"select-star",
				"warning",
				"Select only the columns you need",
				"`SELECT *` returns every column from the source.",
				"Wide projections increase transferred data and make callers depend on schema changes.",
				"Replace `*` with an explicit column list.",
				"select",
			),
		);
	}

	if (hasLimit(ast) && !hasOrder(ast, context.dialect)) {
		out.push(
			finding(
				context,
				"limit-without-order",
				"warning",
				"Limited rows have no defined order",
				"The query has `LIMIT` but no `ORDER BY`.",
				"SQL does not guarantee which qualifying rows appear first without an explicit order.",
				"Add an `ORDER BY` that expresses the intended deterministic priority.",
				"limit",
			),
		);
	}

	const offset =
		context.dialect === "postgres"
			? ast.limit?.offset?.value
			: ast.limit?.value?.length > 1
				? ast.limit.value[1]?.value
				: undefined;
	if (typeof offset === "number" && offset > 0) {
		out.push(
			finding(
				context,
				"offset-pagination",
				"info",
				"OFFSET pagination work grows with page depth",
				`The query skips ${offset} row${offset === 1 ? "" : "s"} before returning a page.`,
				"The database still has to locate and discard preceding rows, and concurrent changes can shift rows between pages.",
				"Use keyset pagination with a stable, indexed ordering key when users can navigate deeply.",
				"limit",
			),
		);
	}

	const orderExpressions =
		context.dialect === "postgres" ? ast.orderBy : ast.orderby;
	if (
		Array.isArray(orderExpressions) &&
		orderExpressions.some((order: any) => {
			const expr = context.dialect === "postgres" ? order.by : order.expr;
			return ["random", "rand"].includes(functionName(expr));
		})
	) {
		out.push(
			finding(
				context,
				"random-order",
				"warning",
				"Random ordering can require work across the full result",
				"The ORDER BY expression calls a random-number function.",
				"Random ordering commonly assigns and sorts a value for every candidate row; actual cost depends on the planner and row count.",
				"For large sets, consider precomputed sampling keys, TABLESAMPLE where appropriate, or another bounded sampling strategy.",
				"orderby",
			),
		);
	}

	if ((type === "update" || type === "delete") && !ast.where) {
		const update = type === "update";
		out.push(
			finding(
				context,
				update ? "update-without-where" : "delete-without-where",
				"danger",
				`${update ? "UPDATE" : "DELETE"} affects every row`,
				`This ${type.toUpperCase()} statement has no WHERE clause.`,
				"Every row in the target table is eligible to be changed.",
				"Add a narrowly scoped `WHERE` predicate, then verify the matching rows with a SELECT first.",
				update ? "update" : "delete",
			),
		);
	}

	const from = Array.isArray(ast.from) ? ast.from : [];
	const cartesian = from.some((source: any, index: number) => {
		if (index === 0) return false;
		const join = String(source.join?.type ?? source.join ?? "").toUpperCase();
		return join.includes("CROSS") || (!source.on && !source.join);
	});
	if (cartesian) {
		out.push(
			finding(
				context,
				"cartesian-join",
				"danger",
				"Cartesian row growth",
				"A CROSS JOIN or comma-separated source combines rows without a join condition.",
				"Each row can pair with every row from the other source, causing rapid result growth.",
				"Use an explicit JOIN with the intended `ON` relationship unless the Cartesian product is deliberate.",
				"join",
				{ sourceSpan: keywordSpan(context.sql, "CROSS JOIN") },
			),
		);
	}

	const tables = tableNames(ast, context.dialect);
	walk(ast.where, (node) => {
		const op = String(node.op ?? node.operator ?? "").toUpperCase();
		const left = node.left;
		const right = node.right;
		if (
			(op === "=" || op === "!=" || op === "<>") &&
			(isNull(left) || isNull(right))
		) {
			out.push(
				finding(
					context,
					"null-comparison",
					"danger",
					"NULL comparison never evaluates to true",
					`The predicate compares NULL with \`${op}\`.`,
					"NULL represents an unknown value, so ordinary equality and inequality produce UNKNOWN rather than true.",
					op === "=" ? "Use `IS NULL`." : "Use `IS NOT NULL`.",
					"where",
				),
			);
		}
		if (op === "NOT IN" && listContainsNull(right)) {
			out.push(
				finding(
					context,
					"not-in-with-null",
					"danger",
					"NOT IN list contains NULL",
					"The NOT IN value list contains a NULL literal.",
					"For every non-matching value, comparison with NULL remains UNKNOWN, so the predicate cannot become true.",
					"Remove NULL from the list and handle it explicitly, or use a NULL-safe `NOT EXISTS` anti-join.",
					"where",
				),
			);
		}
		if (op === "NOT IN" && context.schema) {
			const subquery =
				right?.type === "select"
					? right
					: right?.value?.length === 1
						? right.value[0]?.ast
						: undefined;
			const subTables = subquery
				? tableNames(subquery, context.dialect)
				: new Map<string, string>();
			const projected =
				subquery && Array.isArray(subquery.columns)
					? columnName(subquery.columns[0]?.expr)
					: undefined;
			if (projected && subTables.size === 1) {
				const subTableName = [...subTables.values()][0];
				const column = getTable(context.schema, subTableName)?.columns.find(
					(item) => normalizeIdent(item.name) === normalizeIdent(projected),
				);
				if (column && !column.notNull) {
					out.push(
						finding(
							context,
							"nullable-not-in-subquery",
							"warning",
							"NOT IN subquery can return NULL",
							`\`${subTableName}.${projected}\` is nullable in the supplied DDL.`,
							"A single NULL returned by the subquery can make every otherwise-unmatched NOT IN comparison UNKNOWN.",
							"Use a correlated `NOT EXISTS`, or exclude NULL inside the subquery when that matches the intended semantics.",
							"where",
							{ requiresDdl: true },
						),
					);
				}
			}
		}
		if (op === "LIKE" && left && stringValue(right)?.startsWith("%")) {
			const column = columnName(left);
			out.push(
				finding(
					context,
					"leading-wildcard-like",
					"warning",
					"Leading wildcard prevents a normal index seek",
					`The predicate on \`${column ?? "column"}\` starts with \`%\`.`,
					"A B-tree index cannot seek to an unknown beginning; this is a static estimate, not an EXPLAIN result.",
					"Prefer an anchored prefix, or use a search-specific index when substring search is required.",
					"where",
				),
			);
		}

		const fn =
			left &&
			["call", "cast", "member", "function"].includes(String(left.type));
		if (fn) {
			let ref: Record<string, any> | undefined;
			walk(left, (candidate) => {
				if (!ref && columnName(candidate)) ref = candidate;
			});
			const column = ref && columnName(ref);
			if (
				column &&
				isIndexed(context.schema, tables, column, tableQualifier(ref ?? {}))
			) {
				out.push(
					finding(
						context,
						"indexed-column-expression",
						"warning",
						"Expression wraps an indexed column",
						`An expression is applied to indexed column \`${column}\` in the predicate.`,
						"A plain index on the column generally cannot serve this expression directly; this is DDL-based static analysis.",
						"Rewrite the predicate around the raw column, or add an appropriate expression/generated-column index.",
						"where",
						{ requiresDdl: true },
					),
				);
			}
		}

		if (
			context.schema &&
			(op === "IS" || op === "IS NULL") &&
			(isNull(right) || op === "IS NULL")
		) {
			const ref = columnName(left) ? left : node.operand;
			const column = columnName(ref);
			const qualifier = tableQualifier(ref ?? {});
			const candidates = qualifier
				? [tables.get(normalizeIdent(qualifier)) ?? qualifier]
				: tables.size === 1
					? [...tables.values()]
					: [];
			const impossible = candidates.some((name) =>
				getTable(context.schema, name)?.columns.some(
					(item) =>
						normalizeIdent(item.name) === normalizeIdent(column ?? "") &&
						item.notNull,
				),
			);
			if (column && impossible) {
				out.push(
					finding(
						context,
						"not-null-is-null",
						"warning",
						"NOT NULL column is tested for NULL",
						`\`${column}\` is declared NOT NULL in the supplied DDL.`,
						"With that schema constraint, this predicate cannot match a stored row.",
						"Remove the impossible branch or verify that the supplied DDL matches the deployed schema.",
						"where",
						{ requiresDdl: true },
					),
				);
			}
		}
	});

	if ((type === "update" || type === "delete") && isTautology(ast.where)) {
		out.push(
			finding(
				context,
				"tautological-write-filter",
				"danger",
				"Write filter is always true",
				`This ${type.toUpperCase()} uses a constant predicate that evaluates to true.`,
				"The WHERE clause does not restrict the affected rows.",
				"Replace the constant with the intended row predicate and verify it with SELECT before executing the write.",
				"where",
			),
		);
	}

	const groups = groupColumns(ast, context.dialect);
	if (
		context.dialect === "postgres" &&
		type === "select" &&
		Array.isArray(ast.distinct) &&
		ast.distinct.length > 0
	) {
		const distinctColumns = ast.distinct
			.map((value: any) => columnName(value))
			.filter(Boolean) as string[];
		const ordered = orderColumns(ast, context.dialect);
		const prefixMatches = distinctColumns.every(
			(column, position) =>
				normalizeIdent(column) === normalizeIdent(ordered[position] ?? ""),
		);
		if (ordered.length === 0 || !prefixMatches) {
			out.push(
				finding(
					context,
					"distinct-on-order",
					ordered.length === 0 ? "warning" : "danger",
					ordered.length === 0
						? "DISTINCT ON row choice has no defined order"
						: "DISTINCT ON does not match the ORDER BY prefix",
					ordered.length === 0
						? "DISTINCT ON is used without ORDER BY."
						: `DISTINCT ON (${distinctColumns.join(", ")}) differs from the leading ORDER BY (${ordered.slice(0, distinctColumns.length).join(", ")}).`,
					ordered.length === 0
						? "PostgreSQL may choose any row from each DISTINCT ON group."
						: "PostgreSQL requires DISTINCT ON expressions to match the leftmost ORDER BY expressions.",
					"Start ORDER BY with the DISTINCT ON expressions, then add columns that deterministically choose the preferred row.",
					"distinct_on",
					{ dialects: ["postgres"] },
				),
			);
		}
	}

	if (type === "select" && groups.length > 0 && ast.distinct) {
		out.push(
			finding(
				context,
				"redundant-distinct",
				"info",
				"DISTINCT may repeat GROUP BY work",
				"The query applies DISTINCT to an already grouped result.",
				"GROUP BY already produces one row per grouping key; DISTINCT is often redundant unless projected expressions can still duplicate across groups.",
				"Check whether two groups can project identical rows; remove DISTINCT when the grouping keys are preserved in the projection.",
				"distinct_on",
			),
		);
	}

	if (context.dialect === "mysql" && type === "select" && groups.length > 0) {
		const grouped = new Set(groups.map(normalizeIdent));
		const ungrouped = selectedBareColumns(ast).filter(
			(column) => !grouped.has(normalizeIdent(column)),
		);
		const groupedByUniqueKey =
			context.schema &&
			tables.size === 1 &&
			hasUniqueKey(getTable(context.schema, [...tables.values()][0]), groups);
		if (ungrouped.length > 0 && !groupedByUniqueKey) {
			out.push(
				finding(
					context,
					"non-grouped-select",
					"danger",
					"Selected column is neither grouped nor aggregated",
					`\`${ungrouped[0]}\` is projected but absent from GROUP BY.`,
					"MySQL may reject this under ONLY_FULL_GROUP_BY; permissive modes can choose an arbitrary value from each group.",
					"Add the column to GROUP BY, aggregate it intentionally, or prove a functional dependency with an appropriate key.",
					"select",
					{ dialects: ["mysql"] },
				),
			);
		}
	}

	if (type === "select" && ast.where) {
		for (const source of from) {
			const join = String(source.join?.type ?? source.join ?? "").toUpperCase();
			if (!join.includes("LEFT")) continue;
			const alias =
				context.dialect === "postgres"
					? (source.name?.alias ?? source.name?.name)
					: (source.as ?? source.table);
			const filtered =
				Boolean(alias) && isNullRejectingForAlias(ast.where, alias);
			if (filtered) {
				out.push(
					finding(
						context,
						"left-join-filtered-in-where",
						"warning",
						"WHERE filter removes unmatched LEFT JOIN rows",
						`The WHERE clause filters a column from right-side source \`${alias}\`.`,
						"Rows with no right-side match contain NULL there and are rejected, so the result behaves like an inner join for that condition.",
						"Move the right-side condition into `ON`, explicitly allow NULL, or use INNER JOIN if that is the intent.",
						"where",
					),
				);
			}
		}
	}

	if (context.schema && ast.where) {
		for (const [alias, tableName] of tables) {
			const predicateColumns = new Set<string>();
			walk(ast.where, (node) => {
				const column = columnName(node);
				const qualifier = tableQualifier(node);
				if (
					column &&
					((qualifier &&
						[alias, tableName]
							.map(normalizeIdent)
							.includes(normalizeIdent(qualifier))) ||
						(!qualifier && tables.size === 1))
				) {
					predicateColumns.add(normalizeIdent(column));
				}
			});
			const table = getTable(context.schema, tableName);
			const mismatch = table?.indexes.find(
				(index) =>
					index.columns.length > 1 &&
					!predicateColumns.has(normalizeIdent(index.columns[0])) &&
					index.columns
						.slice(1)
						.some((column) => predicateColumns.has(normalizeIdent(column))),
			);
			if (!mismatch) continue;
			const used = mismatch.columns
				.slice(1)
				.find((column) => predicateColumns.has(normalizeIdent(column)));
			out.push(
				finding(
					context,
					"composite-index-prefix",
					"warning",
					"Composite index leading column is unconstrained",
					`\`${mismatch.name}\` starts with \`${mismatch.columns[0]}\`, but the predicate uses \`${used}\`.`,
					"A normal B-tree generally cannot seek efficiently from a later index column when its leading prefix is unconstrained. This is DDL-based static analysis.",
					"Constrain the leading column when semantically correct, or consider an index whose column order matches this access pattern.",
					"where",
					{ requiresDdl: true },
				),
			);
		}
	}

	if (
		context.schema &&
		type === "select" &&
		hasLimit(ast) &&
		hasOrder(ast, context.dialect) &&
		tables.size === 1
	) {
		const columns = orderColumns(ast, context.dialect);
		const tableName = [...tables.values()][0];
		const table = getTable(context.schema, tableName);
		if (columns.length > 0 && !hasUniqueKey(table, columns)) {
			out.push(
				finding(
					context,
					"limit-order-ties",
					"warning",
					"LIMIT ordering does not uniquely break ties",
					`ORDER BY (${columns.join(", ")}) is not unique in the supplied DDL.`,
					"Rows tied on every ordering expression can exchange positions, so page boundaries are not deterministic.",
					"Append a stable unique key—often the primary key—to ORDER BY.",
					"orderby",
					{ requiresDdl: true },
				),
			);
		}
	}

	if (context.schema && type === "select") {
		for (const source of from) {
			const join = source.join;
			if (!join) continue;
			const tableName =
				context.dialect === "postgres" ? source.name?.name : source.table;
			const alias =
				context.dialect === "postgres"
					? (source.name?.alias ?? tableName)
					: (source.as ?? tableName);
			const on = context.dialect === "postgres" ? join.on : source.on;
			if (!tableName || !alias || !on) continue;
			const joinedColumns = new Set<string>();
			walk(on, (node) => {
				if (
					normalizeIdent(tableQualifier(node) ?? "") === normalizeIdent(alias)
				) {
					const column = columnName(node);
					if (column) joinedColumns.add(column);
				}
			});
			if (joinedColumns.size === 0) continue;
			const table = getTable(context.schema, tableName);
			if (!table || hasUniqueColumnSet(table, [...joinedColumns])) continue;
			out.push(
				finding(
					context,
					"join-may-duplicate",
					"warning",
					"Join key is not unique on the joined side",
					`\`${tableName}\` is joined through (${[...joinedColumns].join(", ")}), which is not unique in the supplied DDL.`,
					"Multiple matching rows on the joined side can repeat each row from the preceding result. This is a schema-based cardinality warning.",
					"Confirm one-to-many behavior is intended, aggregate the joined side first, or enforce the expected uniqueness constraint.",
					"join",
					{ requiresDdl: true },
				),
			);
		}
	}

	return out;
}

function accessFindings(context: HealthContext): HealthFinding[] {
	const out: HealthFinding[] = [];
	for (const node of context.nodes) {
		const access = node.data?.access as
			| { method?: string; reason?: string }
			| undefined;
		if (access?.method !== "full_scan") continue;
		const label = String(node.data?.label ?? "table");
		out.push(
			finding(
				context,
				"estimated-full-scan",
				"info",
				"DDL suggests a full scan",
				`\`${label}\` has no usable index for the extracted predicates.`,
				"This is a simplified, DDL-based access estimate—not the database planner or an EXPLAIN result.",
				"Review predicate selectivity and indexes; confirm any change with your database's EXPLAIN facility.",
				undefined,
				{
					nodeId: node.id,
					sourceSpan: spanOf(node),
					requiresDdl: true,
				},
			),
		);
	}
	return out;
}

export function analyzeQueryHealth(context: HealthContext): HealthFinding[] {
	try {
		const parsed = statements(context.sql, context.dialect);
		const findings = parsed.flatMap((ast) =>
			reviewableBlocks(ast).flatMap((block) =>
				evaluateStatement(context, block),
			),
		);
		findings.push(...accessFindings(context));
		const unique = findings.filter(
			(item, index, all) =>
				all.findIndex(
					(other) =>
						other.ruleId === item.ruleId &&
						other.nodeId === item.nodeId &&
						other.evidence === item.evidence,
				) === index,
		);
		const severity = { danger: 0, warning: 1, info: 2 } as const;
		return unique.sort(
			(a, b) =>
				severity[a.severity] - severity[b.severity] ||
				(a.sourceSpan?.start ?? Number.MAX_SAFE_INTEGER) -
					(b.sourceSpan?.start ?? Number.MAX_SAFE_INTEGER) ||
				a.ruleId.localeCompare(b.ruleId),
		);
	} catch {
		return [];
	}
}

export type { HealthFinding } from "#/lib/query-health/types";
