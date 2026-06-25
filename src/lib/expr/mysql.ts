// biome-ignore lint/suspicious/noExplicitAny: node-sql-parser emits loosely-typed AST nodes
export type MyAst = Record<string, any>;

/** Renders a node-sql-parser identifier reference, stripping backtick wrappers. */
function refName(part: unknown): string {
	if (part == null) return "";
	if (typeof part === "string") return part;
	if (typeof part === "object") {
		const obj = part as MyAst;
		// backticks_quote_string / single/double quote string wrappers
		if (typeof obj.value === "string") return obj.value;
	}
	return String(part);
}

function functionName(name: unknown): string {
	if (typeof name === "string") return name;
	if (name && typeof name === "object") {
		const obj = name as MyAst;
		if (Array.isArray(obj.name)) {
			return obj.name.map((n: MyAst) => refName(n)).join(".");
		}
		if (typeof obj.value === "string") return obj.value;
	}
	return "?";
}

export function renderMyExpr(node: MyAst, depth = 0): string {
	if (depth > 8) return "…";
	if (node == null) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number" || typeof node === "boolean") {
		return String(node);
	}

	switch (node.type) {
		case "column_ref": {
			const tbl = node.table ? `${refName(node.table)}.` : "";
			const col = node.column?.expr ? refName(node.column.expr) : node.column;
			return `${tbl}${refName(col)}`;
		}
		case "binary_expr":
			return `${renderMyExpr(node.left, depth + 1)} ${node.operator} ${renderMyExpr(node.right, depth + 1)}`;
		case "unary_expr":
			return `${node.operator} ${renderMyExpr(node.expr, depth + 1)}`;
		case "number":
			return String(node.value);
		case "single_quote_string":
		case "string":
			return `'${node.value}'`;
		case "double_quote_string":
			return `'${node.value}'`;
		case "backticks_quote_string":
			return String(node.value);
		case "bool":
			return String(node.value);
		case "null":
			return "NULL";
		case "param":
			return `:${node.value ?? "?"}`;
		case "origin":
			return String(node.value ?? "");
		case "aggr_func": {
			const inner = node.args?.expr
				? renderMyExpr(node.args.expr, depth + 1)
				: node.args?.value
					? node.args.value
							.map((a: MyAst) => renderMyExpr(a, depth + 1))
							.join(", ")
					: "*";
			const distinct = node.args?.distinct ? "DISTINCT " : "";
			const over = node.over ? ` ${renderOver(node.over, depth + 1)}` : "";
			return `${node.name}(${distinct}${inner})${over}`;
		}
		case "function": {
			const fn = functionName(node.name);
			const args = node.args?.value
				? node.args.value
						.map((a: MyAst) => renderMyExpr(a, depth + 1))
						.join(", ")
				: "";
			const over = node.over ? ` ${renderOver(node.over, depth + 1)}` : "";
			return `${fn}(${args})${over}`;
		}
		case "expr_list": {
			const items = (node.value ?? []).map((x: MyAst) =>
				renderMyExpr(x, depth + 1),
			);
			return `(${items.join(", ")})`;
		}
		case "cast": {
			const target = node.target?.[0]?.dataType ?? node.target?.dataType ?? "?";
			return `CAST(${renderMyExpr(node.expr, depth + 1)} AS ${target})`;
		}
		case "interval":
			return `INTERVAL ${renderMyExpr(node.expr, depth + 1)} ${node.unit ?? ""}`.trim();
		case "case": {
			return "CASE…END";
		}
		case "star":
			return "*";
		default:
			break;
	}

	if (node.column !== undefined) {
		const tbl = node.table ? `${refName(node.table)}.` : "";
		return `${tbl}${refName(node.column)}`;
	}
	if (node.value !== undefined) return String(node.value);
	if (node.name !== undefined) return functionName(node.name);
	return "(…)";
}

function renderOver(over: MyAst, depth: number): string {
	const spec =
		over?.as_window_specification?.window_specification ??
		over?.window_specification;
	if (!spec) return "OVER ()";
	const parts: string[] = [];
	if (spec.partitionby?.length) {
		const cols = spec.partitionby
			.map((p: MyAst) => renderMyExpr(p.expr ?? p, depth + 1))
			.join(", ");
		parts.push(`PARTITION BY ${cols}`);
	}
	if (spec.orderby?.length) {
		const cols = spec.orderby
			.map(
				(o: MyAst) =>
					`${renderMyExpr(o.expr ?? o, depth + 1)}${o.type ? ` ${o.type}` : ""}`,
			)
			.join(", ");
		parts.push(`ORDER BY ${cols}`);
	}
	return `OVER (${parts.join(" ")})`;
}

/** Extracts a plain table name from a node-sql-parser FROM/table entry. */
export function myTableName(src: MyAst): string {
	if (!src) return "?";
	if (typeof src === "string") return src;
	if (typeof src.table === "string") return src.table;
	if (src.expr?.ast) return "subquery";
	return "?";
}

export function myAliasSuffix(src: MyAst): string {
	if (src?.as) return ` (${refName(src.as)})`;
	return "";
}
