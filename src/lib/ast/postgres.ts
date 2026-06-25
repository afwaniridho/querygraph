import { parse } from "pgsql-ast-parser";
import type { BlockFacts } from "#/lib/access-path";
import { buildFacts } from "#/lib/access-path";
import {
	type Ast,
	aliasSuffix,
	locOf,
	renderExpr,
	tableName,
} from "#/lib/expr/postgres";
import { plainEnglish } from "#/lib/narrate";
import { type FlowResult, Pipeline } from "#/lib/pipeline";
import type { SchemaModel } from "#/lib/schema/schema";

type CteMap = Map<string, string>;

interface SelfReference {
	selfName: string;
	entryId: string | null;
}

/**
 * The PG parser does not understand the RECURSIVE keyword, so it is blanked out
 * (preserving offsets via space padding) before parsing. Recursion is detected
 * structurally from the WITH binding instead.
 */
function stripRecursive(input: string): string {
	return input.replace(/\bRECURSIVE\b/gi, (m) => " ".repeat(m.length));
}

function findCteRefs(expr: Ast, cteMap: CteMap, found: Set<string>) {
	if (!expr || typeof expr !== "object") return;
	if (expr.type === "select" && expr.from) {
		for (const src of expr.from) {
			if (src.type === "table") {
				const ref = cteMap.get(tableName(src));
				if (ref) found.add(ref);
			}
			if (src.join?.on) findCteRefs(src.join.on, cteMap, found);
		}
		if (expr.where) findCteRefs(expr.where, cteMap, found);
		if (expr.having) findCteRefs(expr.having, cteMap, found);
		return;
	}
	for (const val of Object.values(expr)) {
		if (Array.isArray(val)) {
			for (const item of val) findCteRefs(item, cteMap, found);
		} else if (val && typeof val === "object") {
			findCteRefs(val, cteMap, found);
		}
	}
}

function wireCteRefs(expr: Ast, cteMap: CteMap, targetId: string, p: Pipeline) {
	if (cteMap.size === 0) return;
	const refs = new Set<string>();
	findCteRefs(expr, cteMap, refs);
	for (const cteId of refs) p.connect(cteId, targetId, "cte");
}

function buildNestedSelects(
	expr: Ast,
	p: Pipeline,
	cteMap: CteMap,
	parentId: string,
) {
	if (!expr || typeof expr !== "object") return;
	if (expr.type === "select") {
		const outId = buildSelect(expr, p, cteMap);
		p.connect(outId, parentId, "where");
		return;
	}
	for (const val of Object.values(expr)) {
		if (Array.isArray(val)) {
			for (const item of val) buildNestedSelects(item, p, cteMap, parentId);
		} else if (val && typeof val === "object") {
			buildNestedSelects(val, p, cteMap, parentId);
		}
	}
}

function buildSelect(
	ast: Ast,
	p: Pipeline,
	cteMap: CteMap,
	selfRef?: SelfReference,
): string {
	const sources: string[] = [];
	const facts: BlockFacts = p.schema
		? buildFacts(ast, "postgres")
		: (null as never);

	if (ast.from) {
		for (const src of ast.from) {
			const isSelf =
				src.type === "table" && selfRef && tableName(src) === selfRef.selfName;
			if (isSelf && !src.join) continue;

			let srcId: string;
			if (isSelf) {
				srcId = "";
			} else if (src.type === "table") {
				const name = tableName(src);
				const cteRef = cteMap.get(name);
				if (cteRef) {
					srcId = cteRef;
				} else {
					const base = locOf(src.name) ?? locOf(src);
					const alias = src.name?.alias ?? name;
					srcId = p.push(
						`${name}${aliasSuffix(src)}`,
						"table",
						p.withAlias(base, src.name?.alias),
						p.schema ? p.accessFor(name, alias, facts) : undefined,
					);
				}
			} else if (src.type === "select") {
				const subId = buildSelect(src, p, cteMap);
				const alias = src.alias?.name ? ` (${src.alias.name})` : "";
				const wrapId = p.push(`subquery${alias}`, "table", locOf(src));
				p.connect(subId, wrapId, "table");
				srcId = wrapId;
			} else if (src.type === "statement" && src.statement) {
				const subId = dispatch(src.statement, p, cteMap);
				const alias = src.alias ? ` (${src.alias})` : "";
				const wrapId = p.push(`subquery${alias}`, "table", locOf(src));
				p.connect(subId, wrapId, "table");
				srcId = wrapId;
			} else {
				const base = locOf(src.name) ?? locOf(src);
				srcId = p.push(
					tableName(src),
					"table",
					p.withAlias(base, src.name?.alias),
				);
			}

			if (src.join) {
				const natural =
					src.join.natural || /^NATURAL\b/i.test(src.join.type ?? "");
				const joinType = src.join.type ?? "JOIN";
				const onClause =
					!natural && src.join.on ? ` ON ${renderExpr(src.join.on)}` : "";
				const joinId = p.push(`${joinType}${onClause}`, "join", locOf(src));

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
				if (src.join.on) wireCteRefs(src.join.on, cteMap, joinId, p);
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
			`WHERE ${renderExpr(ast.where)}`,
			"where",
			p.withKeyword(locOf(ast.where), "WHERE"),
		);
		p.connect(cursor, id, "flow");
		buildNestedSelects(ast.where, p, cteMap, id);
		wireCteRefs(ast.where, cteMap, id, p);
		cursor = id;
	}

	if (ast.groupBy?.length) {
		const cols = ast.groupBy.map((g: Ast) => renderExpr(g)).join(", ");
		const id = p.push(
			`GROUP BY ${cols}`,
			"groupby",
			p.withKeyword(locOf(ast.groupBy[0]), "GROUP BY"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.having) {
		const id = p.push(
			`HAVING ${renderExpr(ast.having)}`,
			"having",
			p.withKeyword(locOf(ast.having), "HAVING"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.distinct && Array.isArray(ast.distinct) && ast.distinct.length) {
		const cols = ast.distinct.map((d: Ast) => renderExpr(d)).join(", ");
		const id = p.push(
			`DISTINCT ON (${cols})`,
			"distinct_on",
			p.withKeyword(locOf(ast.distinct[0]), "DISTINCT"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	const cols = (ast.columns ?? [])
		.map((c: Ast) => {
			const e = renderExpr(c.expr);
			return c.alias?.name ? `${e} AS ${c.alias.name}` : e;
		})
		.join(", ");
	const selectId = p.push(
		`SELECT ${cols || "*"}`,
		"select",
		p.withKeyword(locOf(ast.columns?.[0]?.expr), "SELECT"),
	);
	p.connect(cursor, selectId, "flow");
	cursor = selectId;

	if (ast.orderBy?.length) {
		const cols2 = ast.orderBy
			.map((o: Ast) => `${renderExpr(o.by)}${o.order ? ` ${o.order}` : ""}`)
			.join(", ");
		const id = p.push(
			`ORDER BY ${cols2}`,
			"orderby",
			p.withKeyword(locOf(ast.orderBy[0]?.by), "ORDER BY"),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.limit?.limit) {
		const id = p.push(
			`LIMIT ${renderExpr(ast.limit.limit)}`,
			"limit",
			locOf(ast.limit.limit),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	return cursor;
}

function buildInsert(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	const target = tableName(ast.into);
	const targetId = p.push(target, "insert_target", locOf(ast.into));

	let sourceId: string;
	if (ast.insert?.type === "select") {
		sourceId = buildSelect(ast.insert, p, cteMap);
	} else if (ast.values) {
		sourceId = p.push("VALUES", "values", locOf(ast.values?.[0]?.[0]));
	} else {
		sourceId = p.push("VALUES", "values");
	}

	const insertId = p.push(`INSERT INTO ${target}`, "insert", locOf(ast));
	p.connect(sourceId, insertId, "flow");
	p.connect(insertId, targetId, "flow");

	let cursor = targetId;
	if (ast.onConflict) {
		const oc = ast.onConflict;
		const doNothing = !oc.do || oc.do === "do nothing";
		const targetExprs = oc.on?.exprs ?? [];
		const targetCols = targetExprs.map((c: Ast) => renderExpr(c)).join(", ");
		const head = targetCols ? `ON CONFLICT (${targetCols})` : "ON CONFLICT";
		const tail = doNothing ? " DO NOTHING" : " DO UPDATE";
		const id = p.push(`${head}${tail}`, "on_conflict", locOf(oc));
		p.connect(cursor, id, "flow");
		cursor = id;
	}

	if (ast.returning?.length) {
		const cols = ast.returning.map((r: Ast) => renderExpr(r.expr)).join(", ");
		const id = p.push(
			`RETURNING ${cols}`,
			"returning",
			locOf(ast.returning[0]?.expr),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}
	return cursor;
}

function buildUpdate(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	const target = tableName(ast.table);
	const facts: BlockFacts = p.schema
		? buildFacts(ast, "postgres")
		: (null as never);
	let cursor = p.push(
		`UPDATE ${target}`,
		"update",
		locOf(ast.table),
		p.schema
			? p.accessFor(target, ast.table?.alias ?? target, facts)
			: undefined,
	);

	if (ast.where) {
		const id = p.push(
			`WHERE ${renderExpr(ast.where)}`,
			"where",
			p.withKeyword(locOf(ast.where), "WHERE"),
		);
		p.connect(cursor, id, "flow");
		wireCteRefs(ast.where, cteMap, id, p);
		cursor = id;
	}

	const sets = (ast.sets ?? [])
		.map((s: Ast) => `${s.column?.name ?? "?"} = ${renderExpr(s.value)}`)
		.join(", ");
	const setId = p.push(
		`SET ${sets}`,
		"set",
		p.withKeyword(locOf(ast.sets?.[0]?.value), "SET"),
	);
	p.connect(cursor, setId, "flow");
	cursor = setId;

	if (ast.returning?.length) {
		const cols = ast.returning.map((r: Ast) => renderExpr(r.expr)).join(", ");
		const id = p.push(
			`RETURNING ${cols}`,
			"returning",
			locOf(ast.returning[0]?.expr),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}
	return cursor;
}

function buildDelete(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	const target = tableName(ast.from);
	const facts: BlockFacts = p.schema
		? buildFacts({ ...ast, from: [ast.from] }, "postgres")
		: (null as never);
	let cursor = p.push(
		`DELETE FROM ${target}`,
		"delete",
		locOf(ast.from),
		p.schema
			? p.accessFor(target, ast.from?.name?.alias ?? target, facts)
			: undefined,
	);

	if (ast.where) {
		const id = p.push(
			`WHERE ${renderExpr(ast.where)}`,
			"where",
			p.withKeyword(locOf(ast.where), "WHERE"),
		);
		p.connect(cursor, id, "flow");
		wireCteRefs(ast.where, cteMap, id, p);
		cursor = id;
	}

	if (ast.returning?.length) {
		const cols = ast.returning.map((r: Ast) => renderExpr(r.expr)).join(", ");
		const id = p.push(
			`RETURNING ${cols}`,
			"returning",
			locOf(ast.returning[0]?.expr),
		);
		p.connect(cursor, id, "flow");
		cursor = id;
	}
	return cursor;
}

function buildCreateTable(ast: Ast, p: Pipeline): string {
	const name = tableName(ast.name);
	const createId = p.push(`CREATE TABLE ${name}`, "create", locOf(ast));
	for (const col of ast.columns ?? []) {
		if (col.kind === "column" || col.name) {
			const typeName = col.dataType?.name ? ` ${col.dataType.name}` : "";
			const colId = p.push(
				`${col.name?.name ?? col.name}${typeName}`,
				"column",
				locOf(col),
			);
			p.connect(createId, colId, "flow");
		}
	}
	return createId;
}

function buildUnion(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	const leftId = dispatch(ast.left, p, cteMap);
	const rightId = dispatch(ast.right, p, cteMap);
	// pgsql-ast-parser leaves `ast.op` undefined for set ops; the type itself
	// distinguishes "union" from "union all".
	const op =
		ast.type === "union all" ? "UNION ALL" : (ast.op ?? "UNION").toUpperCase();
	const unionId = p.push(op, "union", locOf(ast));
	p.connect(leftId, unionId, "flow");
	p.connect(rightId, unionId, "flow");
	return unionId;
}

/**
 * Walks an expression tree looking for any table reference whose name matches
 * `selfName`. Used to detect recursion structurally, since `stripRecursive`
 * blanks out the `RECURSIVE` keyword before parsing.
 */
function referencesSelf(expr: Ast, selfName: string): boolean {
	if (!expr || typeof expr !== "object") return false;
	if (expr.type === "table" && tableName(expr) === selfName) return true;
	for (const val of Object.values(expr)) {
		if (Array.isArray(val)) {
			for (const item of val) if (referencesSelf(item, selfName)) return true;
		} else if (val && typeof val === "object") {
			if (referencesSelf(val, selfName)) return true;
		}
	}
	return false;
}

function buildWith(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	for (const binding of ast.bind ?? []) {
		const name = binding.alias?.name ?? binding.alias ?? "cte";
		const inner = binding.statement;
		const isUnion = inner?.type === "union" || inner?.type === "union all";
		// `stripRecursive` blanks the keyword before parsing, so `ast.recursive`
		// is always undefined here. Detect recursion by checking if a UNION arm
		// references the CTE name being defined.
		const recursive =
			isUnion &&
			(referencesSelf(inner.right, name) || referencesSelf(inner.left, name));
		const label = recursive ? `RECURSIVE: ${name}` : `CTE: ${name}`;
		const cteId = p.push(label, "cte", locOf(binding));
		cteMap.set(name, cteId);

		if (recursive) {
			const selfRef: SelfReference = { selfName: name, entryId: cteId };
			const baseId = dispatch(inner.left, p, cteMap);
			p.connect(baseId, cteId, "flow");
			const recurId = buildSelect(inner.right, p, cteMap, selfRef);
			p.connect(recurId, cteId, "flow", true);
		} else if (inner) {
			const outId = dispatch(inner, p, cteMap);
			p.connect(outId, cteId, "flow");
		}
	}
	return ast.in
		? dispatch(ast.in, p, cteMap)
		: (cteMap.values().next().value ?? "");
}

function dispatch(ast: Ast, p: Pipeline, cteMap: CteMap): string {
	switch (ast?.type) {
		case "with":
		case "with recursive":
			return buildWith(ast, p, cteMap);
		case "union":
		case "union all":
			return buildUnion(ast, p, cteMap);
		case "select":
			return buildSelect(ast, p, cteMap);
		case "insert":
			return buildInsert(ast, p, cteMap);
		case "update":
			return buildUpdate(ast, p, cteMap);
		case "delete":
			return buildDelete(ast, p, cteMap);
		case "create table":
			return buildCreateTable(ast, p);
		default:
			return p.push(ast?.type ?? "statement", "operation", locOf(ast));
	}
}

/**
 * Parses PostgreSQL SQL and builds the shared Pipeline IR. The RECURSIVE keyword
 * is blanked (length-preserving) so offsets still line up with the original SQL
 * the editor shows.
 */
export function buildPostgresFlow(
	input: string,
	schema?: SchemaModel,
): FlowResult {
	const stripped = stripRecursive(input);
	const statements = parse(stripped, { locationTracking: true }) as Ast[];
	const p = new Pipeline(
		input,
		(kind, label, access) => plainEnglish(kind, label, "postgres", access),
		"postgres",
		schema,
	);
	const cteMap: CteMap = new Map();
	for (const stmt of statements) dispatch(stmt, p, cteMap);
	return p.render();
}
