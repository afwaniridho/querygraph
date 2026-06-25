// biome-ignore lint/suspicious/noExplicitAny: pgsql-ast-parser emits loosely-typed AST nodes
export type Ast = Record<string, any>;

import type { SourceSpan } from "#/lib/pipeline";

export function renderExpr(node: Ast, depth = 0): string {
	if (depth > 6) return "…";
	if (node == null) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number" || typeof node === "boolean") {
		return String(node);
	}

	switch (node.type) {
		case "ref": {
			const prefix = node.table?.name ? `${node.table.name}.` : "";
			return `${prefix}${node.name}`;
		}
		case "binary":
			return `${renderExpr(node.left, depth + 1)} ${node.op} ${renderExpr(node.right, depth + 1)}`;
		case "unary":
			return `${node.op} ${renderExpr(node.operand, depth + 1)}`;
		case "integer":
		case "numeric":
			return String(node.value);
		case "string":
			return `'${node.value}'`;
		case "boolean":
			return String(node.value);
		case "null":
			return "NULL";
		case "parameter":
			return `$${node.name ?? "?"}`;
		case "call": {
			const fn = node.function?.name ?? "?";
			const args = (node.args ?? [])
				.map((a: Ast) => renderExpr(a, depth + 1))
				.join(", ");
			return `${fn}(${args})`;
		}
		case "cast":
			return `CAST(${renderExpr(node.operand, depth + 1)} AS ${node.to?.name ?? "?"})`;
		case "member":
			return `${renderExpr(node.operand, depth + 1)}.${node.member}`;
		case "arrayIndex":
			return `${renderExpr(node.array, depth + 1)}[${renderExpr(node.index, depth + 1)}]`;
		case "list":
		case "array": {
			const items = (node.expressions ?? []).map((x: Ast) =>
				renderExpr(x, depth + 1),
			);
			return `(${items.join(", ")})`;
		}
		case "case":
			return "CASE…END";
		case "ternary":
			return `${renderExpr(node.value, depth + 1)} BETWEEN ${renderExpr(node.lo, depth + 1)} AND ${renderExpr(node.hi, depth + 1)}`;
		case "select": {
			const cols = (node.columns ?? [])
				.map((c: Ast) => renderExpr(c.expr, depth + 1))
				.join(", ");
			const from = (node.from ?? []).map((f: Ast) => tableName(f)).join(", ");
			let body = `SELECT ${cols || "*"}`;
			if (from) body += ` FROM ${from}`;
			return `(${body})`;
		}
		case "values":
			return "(values)";
		case "constant":
			return String(node.value ?? "?");
		case "keyword":
			return String(node.keyword ?? node.value ?? "");
		default:
			break;
	}

	if (node.value !== undefined) return String(node.value);
	if (node.name !== undefined) return String(node.name);
	return "(…)";
}

export function tableName(src: Ast): string {
	if (!src) return "?";
	if (typeof src === "string") return src;
	if (src.name) {
		if (typeof src.name === "string") return src.name;
		if (src.name.name) return src.name.name;
	}
	if (src.alias) return src.alias;
	return "?";
}

export function aliasSuffix(src: Ast): string {
	if (!src) return "";
	const name = src.name ?? src;
	if (name?.alias) return ` (${name.alias})`;
	return "";
}

export function locOf(node: Ast): SourceSpan | undefined {
	return node?._location ?? undefined;
}
