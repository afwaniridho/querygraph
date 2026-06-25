import {
	type BlockFacts,
	type ColumnPredicate,
	type ColumnRef,
	emptyFacts,
} from "#/lib/access-path/types";
import type { Ast } from "#/lib/expr/postgres";

const RANGE_OPS = new Set([">", "<", ">=", "<=", "BETWEEN"]);
const EQ_OPS = new Set(["=", "IN"]);

function refOf(node: Ast): ColumnRef | null {
	if (node?.type === "ref" && node.name && node.name !== "*") {
		return { table: node.table?.name, column: node.name };
	}
	return null;
}

// A column wrapped in a function/cast (lower(x), x::int) can't use a plain index.
function hasFunctionOnColumn(node: Ast): boolean {
	return (
		node?.type === "call" || node?.type === "cast" || node?.type === "member"
	);
}

function pushSide(
	preds: ColumnPredicate[],
	side: Ast,
	other: Ast,
	op: string,
): void {
	const ref = refOf(side);
	if (!ref) {
		if (hasFunctionOnColumn(side)) {
			const inner = refOf(side.operand ?? side.args?.[0]);
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
	// other side must be a constant/param for a sargable comparison
	const otherRef = refOf(other);
	const kind = EQ_OPS.has(op) ? "equality" : RANGE_OPS.has(op) ? "range" : null;
	if (!kind) return;
	if (otherRef) {
		// column = column is a join predicate; still equality on this column.
		preds.push({ ...ref, kind: "equality" });
		preds.push({ ...otherRef, kind: "equality" });
		return;
	}
	preds.push({ ...ref, kind });
}

function walk(node: Ast, preds: ColumnPredicate[], negated: boolean): void {
	if (!node || typeof node !== "object") return;

	if (node.type === "binary") {
		const op = String(node.op ?? "").toUpperCase();
		if (op === "OR") {
			// OR across different columns generally defeats single-index use.
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
			const val = node.right;
			if (ref) {
				const lit = typeof val?.value === "string" ? val.value : "";
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

	if (node.type === "unary") {
		const op = String(node.op ?? "").toUpperCase();
		if (op === "NOT") {
			walk(node.operand, preds, !negated);
			return;
		}
	}

	if (node.type === "ternary") {
		// BETWEEN lo AND hi → range on the value column.
		const ref = refOf(node.value);
		if (ref) preds.push({ ...ref, kind: "range" });
		return;
	}

	for (const val of Object.values(node)) {
		if (Array.isArray(val)) for (const v of val) walk(v, preds, negated);
		else if (val && typeof val === "object") walk(val, preds, negated);
	}
}

function collectRefs(node: Ast, out: ColumnRef[]): void {
	if (!node || typeof node !== "object") return;
	const r = refOf(node);
	if (r) out.push(r);
	for (const val of Object.values(node)) {
		if (Array.isArray(val)) for (const v of val) collectRefs(v, out);
		else if (val && typeof val === "object") collectRefs(val, out);
	}
}

export function buildPostgresFacts(ast: Ast): BlockFacts {
	const facts = emptyFacts();

	for (const src of ast.from ?? []) {
		if (src.type === "table" && src.name?.name) {
			const alias = src.name.alias ?? src.name.name;
			facts.aliasToTable.set(alias.toLowerCase(), src.name.name.toLowerCase());
		}
		if (src.join?.on) walk(src.join.on, facts.predicates, false);
	}

	if (ast.where) walk(ast.where, facts.predicates, false);

	for (const g of ast.groupBy ?? []) {
		const r = refOf(g);
		if (r) facts.sortColumns.push(r);
	}
	for (const o of ast.orderBy ?? []) {
		const r = refOf(o.by);
		if (r) facts.sortColumns.push(r);
	}

	for (const c of ast.columns ?? []) {
		const r = refOf(c.expr);
		if (r) facts.projectedColumns.push(r);
		else if (c.expr?.type === "ref" && c.expr.name === "*") {
			facts.selectStar = true;
		} else {
			collectRefs(c.expr, facts.projectedColumns);
		}
	}
	if (!ast.columns?.length) facts.selectStar = true;

	return facts;
}
