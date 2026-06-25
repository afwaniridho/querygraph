import { Parser } from "node-sql-parser";
import type { BlockFacts } from "#/lib/access-path";
import { buildFacts } from "#/lib/access-path";
import {
	type MyAst,
	myAliasSuffix,
	myTableName,
	renderMyExpr,
} from "#/lib/expr/mysql";
import { plainEnglish } from "#/lib/narrate";
import { type FlowResult, Pipeline, type SourceSpan } from "#/lib/pipeline";
import type { SchemaModel } from "#/lib/schema/schema";

const parser = new Parser();

type CteMap = Map<string, string>;

interface SelfReference {
	selfName: string;
	entryId: string | null;
}

/**
 * node-sql-parser does not expose per-clause source offsets, so we re-locate a
 * clause by scanning the SQL for its keyword. This mirrors the PG `withKeyword`
 * heuristic: find the first occurrence at/after `from`, and span to the end of
 * the matched keyword (callers usually only need a stable anchor to highlight).
 */
function locateClause(
	sql: string,
	keyword: string,
	from = 0,
): SourceSpan | undefined {
	const haystack = sql.toUpperCase();
	const needle = keyword.toUpperCase();
	const idx = haystack.indexOf(needle, from);
	if (idx < 0) return undefined;
	return { start: idx, end: idx + needle.length };
}

/** Locates an identifier (table/column) as a word, optionally after `from`. */
function locateWord(
	sql: string,
	word: string,
	from = 0,
): SourceSpan | undefined {
	if (!word) return undefined;
	const re = new RegExp(
		`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
		"i",
	);
	const sliced = sql.slice(from);
	const m = re.exec(sliced);
	if (!m) return undefined;
	return { start: from + m.index, end: from + m.index + m[0].length };
}

function joinTypeLabel(join: string): string {
	const j = join.toUpperCase();
	if (j.includes("STRAIGHT")) return "STRAIGHT_JOIN";
	return j;
}

function buildSelect(
	ast: MyAst,
	p: Pipeline,
	cteMap: CteMap,
	selfRef?: SelfReference,
): string {
	const sql = p.source;
	const sources: string[] = [];
	const facts: BlockFacts = p.schema
		? buildFacts(ast, "mysql")
		: (null as never);

	if (Array.isArray(ast.from)) {
		for (const src of ast.from) {
			const isSelf =
				typeof src.table === "string" &&
				selfRef &&
				src.table === selfRef.selfName;

			let srcId = "";
			if (isSelf && !src.join) {
				continue;
			} else if (isSelf) {
				srcId = "";
			} else if (src.expr?.ast) {
				const subId = buildSelect(src.expr.ast, p, cteMap);
				const alias = src.as ? ` (${src.as})` : "";
				const wrapId = p.push(
					`subquery${alias}`,
					"table",
					locateClause(sql, "("),
				);
				p.connect(subId, wrapId, "table");
				srcId = wrapId;
			} else {
				const name = myTableName(src);
				const cteRef = cteMap.get(name);
				if (cteRef) {
					srcId = cteRef;
				} else {
					srcId = p.push(
						`${name}${myAliasSuffix(src)}`,
						"table",
						locateWord(sql, name),
						p.schema ? p.accessFor(name, src.as ?? name, facts) : undefined,
					);
				}
			}

			if (src.join) {
				if (/\bFULL\b/i.test(src.join)) {
					throw new Error("MySQL does not support FULL OUTER JOIN.");
				}
				const label = joinTypeLabel(src.join);
				const kind = label === "STRAIGHT_JOIN" ? "straight_join" : "join";
				const onClause = src.on ? ` ON ${renderMyExpr(src.on)}` : "";
				const joinId = p.push(
					`${label}${onClause}`,
					kind,
					locateClause(sql, label.split(" ")[0]),
				);

				if (sources.length > 0) {
					p.connect(sources[sources.length - 1], joinId, "join");
					sources[sources.length - 1] = joinId;
				} else {
					sources.push(joinId);
				}
				if (!isSelf && srcId) p.connect(srcId, joinId, "join");
				if (isSelf && selfRef?.entryId) {
					p.connect(selfRef.entryId, joinId, "cte", true);
				}
			} else if (srcId) {
				sources.push(srcId);
			}
		}
	}

	let cursor: string;
	if (sources.length === 0) {
		cursor = p.push("(no source)", "table");
	} else if (sources.length === 1) {
		cursor = sources[0];
	} else {
		cursor = p.push("combine sources", "operation");
		for (const s of sources) p.connect(s, cursor, "flow");
	}

	if (ast.where) {
		const id = p.push(
			`WHERE ${renderMyExpr(ast.where)}`,
			"where",
			locateClause(sql, "WHERE"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	const groupCols = ast.groupby?.columns ?? ast.groupby;
	if (Array.isArray(groupCols) && groupCols.length) {
		const cols = groupCols.map((g: MyAst) => renderMyExpr(g)).join(", ");
		const id = p.push(
			`GROUP BY ${cols}`,
			"groupby",
			locateClause(sql, "GROUP BY"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.having) {
		const id = p.push(
			`HAVING ${renderMyExpr(ast.having)}`,
			"having",
			locateClause(sql, "HAVING"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.distinct) {
		const id = p.push("DISTINCT", "distinct_on", locateClause(sql, "DISTINCT"));
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	// node-sql-parser sometimes hands back the literal string "*" instead of an
	// object for SELECT *, hence the runtime string check.
	const cols = (ast.columns ?? [])
		.map((c: MyAst | string) => {
			if (typeof c === "string") return c;
			if (c?.expr?.column === "*") return "*";
			const e = renderMyExpr(c.expr);
			return c.as ? `${e} AS ${c.as}` : e;
		})
		.join(", ");
	const selectId = p.push(
		`SELECT ${cols || "*"}`,
		"select",
		locateClause(sql, "SELECT"),
	);
	p.connect(cursor, selectId, "flow");
	cursor = selectId;

	if (Array.isArray(ast.orderby) && ast.orderby.length) {
		const cols2 = ast.orderby
			.map((o: MyAst) => `${renderMyExpr(o.expr)}${o.type ? ` ${o.type}` : ""}`)
			.join(", ");
		const id = p.push(
			`ORDER BY ${cols2}`,
			"orderby",
			locateClause(sql, "ORDER BY"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.limit?.value?.length) {
		const vals = ast.limit.value.map((v: MyAst) => v.value);
		const label =
			ast.limit.seperator === "," && vals.length === 2
				? `LIMIT ${vals[1]} OFFSET ${vals[0]}`
				: `LIMIT ${vals.join(", ")}`;
		const id = p.push(label, "limit", locateClause(sql, "LIMIT"));
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	return cursor;
}

function buildInsertOrReplace(ast: MyAst, p: Pipeline, cteMap: CteMap): string {
	const sql = p.source;
	const isReplace = ast.type === "replace";
	const prefix = String(ast.prefix ?? "into").toLowerCase();
	const ignore = prefix.includes("ignore");
	const target = myTableName(
		Array.isArray(ast.table) ? ast.table[0] : ast.table,
	);
	const targetId = p.push(target, "insert_target", locateWord(sql, target));

	let sourceId: string;
	if (ast.values?.type === "select" || ast.values?.ast) {
		const inner = ast.values.ast ?? ast.values;
		sourceId = buildSelect(inner, p, cteMap);
	} else {
		sourceId = p.push("VALUES", "values", locateClause(sql, "VALUES"));
	}

	let writeKind: string;
	let writeLabel: string;
	if (isReplace) {
		writeKind = "replace";
		writeLabel = `REPLACE INTO ${target}`;
	} else if (ignore) {
		writeKind = "insert_ignore";
		writeLabel = `INSERT IGNORE INTO ${target}`;
	} else {
		writeKind = "insert";
		writeLabel = `INSERT INTO ${target}`;
	}
	const writeId = p.push(
		writeLabel,
		writeKind,
		locateClause(sql, isReplace ? "REPLACE" : "INSERT"),
	);
	p.connect(sourceId, writeId, "flow");
	p.connect(writeId, targetId, "flow");

	let cursor = targetId;
	if (ast.on_duplicate_update?.set?.length) {
		const sets = ast.on_duplicate_update.set
			.map((s: MyAst) => `${s.column} = ${renderMyExpr(s.value)}`)
			.join(", ");
		const id = p.push(
			`ON DUPLICATE KEY UPDATE ${sets}`,
			"on_duplicate_key",
			locateClause(sql, "ON DUPLICATE"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}
	return cursor;
}

function buildUpdate(ast: MyAst, p: Pipeline): string {
	const sql = p.source;
	const tables = Array.isArray(ast.table) ? ast.table : [ast.table];
	const multi = tables.length > 1 || tables.some((t: MyAst) => t.join);
	const names = tables.map((t: MyAst) => myTableName(t)).join(", ");

	let cursor: string;
	if (multi) {
		cursor = p.push(
			`UPDATE ${names}`,
			"multi_table_update",
			locateClause(sql, "UPDATE"),
		);
		for (const t of tables) {
			if (t.join && t.on) {
				const onClause = ` ON ${renderMyExpr(t.on)}`;
				const joinId = p.push(
					`${joinTypeLabel(t.join)}${onClause}`,
					"join",
					locateWord(sql, myTableName(t)),
				);
				p.connect(joinId, cursor, "join");
			}
		}
	} else {
		const facts: BlockFacts = p.schema
			? buildFacts(ast, "mysql")
			: (null as never);
		const t0 = tables[0];
		cursor = p.push(
			`UPDATE ${names}`,
			"update",
			locateClause(sql, "UPDATE"),
			p.schema
				? p.accessFor(myTableName(t0), t0?.as ?? myTableName(t0), facts)
				: undefined,
		);
	}

	if (ast.where) {
		const id = p.push(
			`WHERE ${renderMyExpr(ast.where)}`,
			"where",
			locateClause(sql, "WHERE"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	const sets = (ast.set ?? [])
		.map((s: MyAst) => {
			const col = s.table ? `${s.table}.${s.column}` : s.column;
			return `${col} = ${renderMyExpr(s.value)}`;
		})
		.join(", ");
	const setId = p.push(`SET ${sets}`, "set", locateClause(sql, "SET"));
	p.connect(cursor, setId, "flow");
	cursor = setId;

	return cursor;
}

function buildDelete(ast: MyAst, p: Pipeline): string {
	const sql = p.source;
	const fromTables = Array.isArray(ast.from) ? ast.from : [];
	const deleteTargets = Array.isArray(ast.table) ? ast.table : [];
	// node-sql-parser populates `ast.table` for every DELETE (even single-table),
	// so `deleteTargets.length > 0` is always true. Multi-table form is only
	// triggered when there are 2+ targets, 2+ FROM tables, or a JOIN.
	const multi =
		deleteTargets.length > 1 ||
		fromTables.length > 1 ||
		fromTables.some((t: MyAst) => t.join);

	let cursor: string;
	if (multi) {
		const targetNames = (deleteTargets.length ? deleteTargets : fromTables)
			.map((t: MyAst) => myTableName(t))
			.join(", ");
		cursor = p.push(
			`DELETE ${targetNames}`,
			"multi_table_delete",
			locateClause(sql, "DELETE"),
		);
		for (const t of fromTables) {
			if (t.join && t.on) {
				const joinId = p.push(
					`${joinTypeLabel(t.join)} ON ${renderMyExpr(t.on)}`,
					"join",
					locateWord(sql, myTableName(t)),
				);
				p.connect(joinId, cursor, "join");
			}
		}
	} else {
		const target = myTableName(fromTables[0] ?? deleteTargets[0]);
		const facts: BlockFacts = p.schema
			? buildFacts(
					{
						...ast,
						from: fromTables.length ? fromTables : [{ table: target }],
					},
					"mysql",
				)
			: (null as never);
		cursor = p.push(
			`DELETE FROM ${target}`,
			"delete",
			locateClause(sql, "DELETE"),
			p.schema ? p.accessFor(target, target, facts) : undefined,
		);
	}

	if (ast.where) {
		const id = p.push(
			`WHERE ${renderMyExpr(ast.where)}`,
			"where",
			locateClause(sql, "WHERE"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	return cursor;
}

function buildCreateTable(ast: MyAst, p: Pipeline): string {
	const sql = p.source;
	const name = myTableName(Array.isArray(ast.table) ? ast.table[0] : ast.table);
	const createId = p.push(
		`CREATE TABLE ${name}`,
		"create",
		locateClause(sql, "CREATE"),
	);
	for (const def of ast.create_definitions ?? []) {
		if (def.resource === "column") {
			const colName = def.column?.column ?? "?";
			const dataType = def.definition?.dataType ?? "";
			const len = def.definition?.length ? `(${def.definition.length})` : "";
			const auto = def.auto_increment ? " AUTO_INCREMENT" : "";
			const pk = def.primary_key ? " PRIMARY KEY" : "";
			const colId = p.push(
				`${colName} ${dataType}${len}${auto}${pk}`.trim(),
				"column",
				locateWord(sql, colName),
			);
			p.connect(createId, colId, "flow");
		}
	}
	return createId;
}

function buildUnion(ast: MyAst, p: Pipeline, cteMap: CteMap): string {
	const sql = p.source;
	const leftId = buildSelect(ast, p, cteMap);
	const op = String(ast.set_op ?? "union").toUpperCase();
	const rightId = dispatch(ast._next, p, cteMap);
	const unionId = p.push(op, "union", locateClause(sql, "UNION"));
	p.connect(leftId, unionId, "flow");
	p.connect(rightId, unionId, "flow");
	return unionId;
}

function buildWith(ast: MyAst, p: Pipeline, cteMap: CteMap): string {
	const sql = p.source;
	for (const binding of ast.with ?? []) {
		const name = binding.name?.value ?? binding.name ?? "cte";
		const recursive = binding.recursive === true;
		const label = recursive ? `RECURSIVE: ${name}` : `CTE: ${name}`;
		const cteId = p.push(label, "cte", locateWord(sql, String(name)));
		cteMap.set(String(name), cteId);

		const inner = binding.stmt?.ast ?? binding.stmt;
		if (inner?.set_op && inner?._next) {
			const selfRef: SelfReference = {
				selfName: String(name),
				entryId: cteId,
			};
			const baseId = buildSelect(inner, p, cteMap);
			p.connect(baseId, cteId, "flow");
			const recurId = buildSelect(inner._next, p, cteMap, selfRef);
			p.connect(recurId, cteId, "flow", true);
		} else if (inner) {
			const outId = dispatch(inner, p, cteMap);
			p.connect(outId, cteId, "flow");
		}
	}
	// Build the main statement, which carries the same `with` array; clear it to
	// avoid re-emitting the CTE bindings.
	const main = { ...ast, with: null };
	return dispatch(main, p, cteMap);
}

function dispatch(ast: MyAst, p: Pipeline, cteMap: CteMap): string {
	if (!ast) return p.push("statement", "operation");
	if (ast.with?.length) return buildWith(ast, p, cteMap);
	switch (ast.type) {
		case "select":
			return ast._next && ast.set_op
				? buildUnion(ast, p, cteMap)
				: buildSelect(ast, p, cteMap);
		case "insert":
		case "replace":
			return buildInsertOrReplace(ast, p, cteMap);
		case "update":
			return buildUpdate(ast, p);
		case "delete":
			return buildDelete(ast, p);
		case "create":
			return buildCreateTable(ast, p);
		default:
			return p.push(String(ast.type ?? "statement"), "operation");
	}
}

/**
 * `node-sql-parser` parses many administrative / introspection statements
 * (GRANT, REVOKE, EXPLAIN, …) successfully, which would otherwise bypass
 * `mysqlHint()` and render as opaque "operation" nodes. We reject them here so
 * the friendly-error path in `parseSql` can show a helpful hint, matching the
 * PostgreSQL adapter's behavior.
 */
const UNSUPPORTED_MYSQL_TYPES = new Set([
	"grant",
	"revoke",
	"explain",
	"desc",
	"describe",
	"show",
]);

/** Parses MySQL 8.0+ SQL and builds the shared Pipeline IR. */
export function buildMysqlFlow(
	input: string,
	schema?: SchemaModel,
): FlowResult {
	const result = parser.astify(input, { database: "mysql" });
	const statements = Array.isArray(result) ? result : [result];
	for (const stmt of statements) {
		const t = (stmt as MyAst | null)?.type;
		if (typeof t === "string" && UNSUPPORTED_MYSQL_TYPES.has(t.toLowerCase())) {
			throw new Error(`Unsupported MySQL statement type: ${t}`);
		}
	}
	const p = new Pipeline(
		input,
		(kind, label, access) => plainEnglish(kind, label, "mysql", access),
		"mysql",
		schema,
	);
	const cteMap: CteMap = new Map();
	for (const stmt of statements) dispatch(stmt as MyAst, p, cteMap);
	return p.render();
}
