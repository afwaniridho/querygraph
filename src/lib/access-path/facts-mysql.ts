import {
	type BlockFacts,
	type ColumnPredicate,
	type ColumnRef,
	emptyFacts,
} from "#/lib/access-path/types";
import type { MyAst } from "#/lib/expr/mysql";

const RANGE_OPS = new Set([">", "<", ">=", "<=", "BETWEEN"]);
const EQ_OPS = new Set(["=", "IN"]);

function colName(node: MyAst): string {
	const c = node?.column;
	if (typeof c === "string") return c;
	if (c?.expr?.value) return String(c.expr.value);
	if (typeof node?.value === "string") return node.value;
	return "";
}

function refOf(node: MyAst): ColumnRef | null {
	if (node?.type === "column_ref") {
		const column = colName(node);
		if (!column || column === "*") return null;
		const table =
			typeof node.table === "string" ? node.table : node.table?.value;
		return { table: table ?? undefined, column };
	}
	return null;
}

function hasFunctionOnColumn(node: MyAst): boolean {
	return (
		node?.type === "function" ||
		node?.type === "cast" ||
		node?.type === "aggr_func"
	);
}

function innerRef(node: MyAst): ColumnRef | null {
	const args = node?.args?.value ?? node?.args ?? [];
	const list = Array.isArray(args) ? args : [args];
	for (const a of list) {
		const r = refOf(a) ?? refOf(a?.expr);
		if (r) return r;
	}
	return refOf(node?.expr);
}

function pushSide(
	preds: ColumnPredicate[],
	side: MyAst,
	other: MyAst,
	op: string,
): void {
	const ref = refOf(side);
	if (!ref) {
		if (hasFunctionOnColumn(side)) {
			const inner = innerRef(side);
			if (inner) {
				preds.push({
					...inner,
					kind: "defeated",
					reason: `a function wraps \`${inner.column}\`, so the index can't be used`,
				});
			}
		}
		return;
	}
	const otherRef = refOf(other);
	const kind = EQ_OPS.has(op) ? "equality" : RANGE_OPS.has(op) ? "range" : null;
	if (!kind) return;
	if (otherRef) {
		preds.push({ ...ref, kind: "equality" });
		preds.push({ ...otherRef, kind: "equality" });
		return;
	}
	preds.push({ ...ref, kind });
}

function collectRefs(node: MyAst, out: ColumnRef[]): void {
	if (!node || typeof node !== "object") return;
	const r = refOf(node);
	if (r) out.push(r);
	for (const val of Object.values(node)) {
		if (Array.isArray(val)) for (const v of val) collectRefs(v, out);
		else if (val && typeof val === "object") collectRefs(val, out);
	}
}

function walk(node: MyAst, preds: ColumnPredicate[], negated: boolean): void {
	if (!node || typeof node !== "object") return;

	if (node.type === "binary_expr") {
		const op = String(node.operator ?? "").toUpperCase();
		if (op === "OR") {
			const refs: ColumnRef[] = [];
			collectRefs(node, refs);
			const distinct = new Set(refs.map((r) => r.column.toLowerCase()));
			if (distinct.size > 1) {
				for (const r of refs) {
					preds.push({
						...r,
						kind: "defeated",
						reason:
							"an OR spans multiple columns, which a single index can't satisfy",
					});
				}
				return;
			}
			walk(node.left, preds, negated);
			walk(node.right, preds, negated);
			return;
		}
		if (op === "AND") {
			walk(node.left, preds, negated);
			walk(node.right, preds, negated);
			return;
		}
		if (op === "BETWEEN") {
			const ref = refOf(node.left);
			if (ref) preds.push({ ...ref, kind: "range" });
			return;
		}
		if (op === "!=" || op === "<>") {
			const ref = refOf(node.left) ?? refOf(node.right);
			if (ref) {
				preds.push({
					...ref,
					kind: "defeated",
					reason: "an inequality (`!=`) can't be served by an index",
				});
			}
			return;
		}
		if (op === "LIKE") {
			const ref = refOf(node.left);
			const lit = typeof node.right?.value === "string" ? node.right.value : "";
			if (ref) {
				if (lit.startsWith("%")) {
					preds.push({
						...ref,
						kind: "defeated",
						reason: "a leading-wildcard LIKE (`%…`) can't use an index",
					});
				} else {
					preds.push({ ...ref, kind: "range" });
				}
			}
			return;
		}
		const effectiveOp = negated ? "" : op;
		pushSide(preds, node.left, node.right, effectiveOp);
		pushSide(preds, node.right, node.left, effectiveOp);
		return;
	}

	if (node.type === "unary_expr") {
		const op = String(node.operator ?? "").toUpperCase();
		if (op === "NOT") {
			walk(node.expr, preds, !negated);
			return;
		}
	}

	for (const val of Object.values(node)) {
		if (Array.isArray(val)) for (const v of val) walk(v, preds, negated);
		else if (val && typeof val === "object") walk(val, preds, negated);
	}
}

export function buildMysqlFacts(ast: MyAst): BlockFacts {
	const facts = emptyFacts();

	if (Array.isArray(ast.from)) {
		for (const src of ast.from) {
			if (typeof src.table === "string") {
				const alias = src.as ?? src.table;
				facts.aliasToTable.set(
					String(alias).toLowerCase(),
					src.table.toLowerCase(),
				);
			}
			if (src.on) walk(src.on, facts.predicates, false);
		}
	}

	if (ast.where) walk(ast.where, facts.predicates, false);

	const groupCols = ast.groupby?.columns ?? ast.groupby;
	if (Array.isArray(groupCols)) {
		for (const g of groupCols) {
			const r = refOf(g);
			if (r) facts.sortColumns.push(r);
		}
	}
	if (Array.isArray(ast.orderby)) {
		for (const o of ast.orderby) {
			const r = refOf(o.expr);
			if (r) facts.sortColumns.push(r);
		}
	}

	const cols = ast.columns;
	if (!Array.isArray(cols) || !cols.length) {
		facts.selectStar = true;
	} else {
		for (const c of cols) {
			if (typeof c === "string") {
				if (c === "*") facts.selectStar = true;
				continue;
			}
			if (c?.expr?.column === "*") {
				facts.selectStar = true;
				continue;
			}
			const r = refOf(c.expr);
			if (r) facts.projectedColumns.push(r);
			else collectRefs(c.expr, facts.projectedColumns);
		}
	}

	return facts;
}
