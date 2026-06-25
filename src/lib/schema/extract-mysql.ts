import { Parser } from "node-sql-parser";
import type { MyAst } from "#/lib/expr/mysql";
import {
	type ColumnSchema,
	ensureTable,
	type SchemaModel,
	synthesizeKeyIndexes,
	type TableSchema,
	upsertTable,
} from "#/lib/schema/schema";

const parser = new Parser();

function tableNameOf(node: MyAst): string {
	const t = Array.isArray(node) ? node[0] : node;
	if (!t) return "";
	if (typeof t === "string") return t;
	return t.table ?? "";
}

function defColumns(defs: MyAst[] | undefined): string[] {
	return (defs ?? [])
		.map((d: MyAst) => (typeof d === "string" ? d : d.column))
		.filter(Boolean);
}

function readColumnDef(def: MyAst, table: TableSchema): void {
	const name = def.column?.column ?? "";
	if (!name) return;
	const type = String(def.definition?.dataType ?? "").toUpperCase();
	const notNull = def.nullable?.type === "not null";
	table.columns.push({ name, type, notNull } satisfies ColumnSchema);
	if (def.primary_key === "primary key" || def.primary_key) {
		table.primaryKey = [name];
	}
	if (def.unique === "unique" || def.unique_or_primary === "unique") {
		table.uniques.push([name]);
	}
}

function readConstraintDef(def: MyAst, table: TableSchema): void {
	const ct = String(def.constraint_type ?? "").toLowerCase();
	const cols = defColumns(def.definition);
	if (ct === "primary key") {
		table.primaryKey = cols;
	} else if (ct === "unique key" || ct === "unique") {
		table.uniques.push(cols);
		table.indexes.push({
			name: def.index ?? `unique(${cols.join(", ")})`,
			columns: cols,
			unique: true,
			origin: "unique",
		});
	} else if (ct === "foreign key") {
		const ref = def.reference_definition;
		table.foreignKeys.push({
			columns: cols,
			refTable: tableNameOf(ref?.table),
			refColumns: defColumns(ref?.definition),
		});
	}
}

function buildTable(ast: MyAst): TableSchema {
	const table: TableSchema = {
		name: tableNameOf(ast.table),
		columns: [],
		primaryKey: [],
		uniques: [],
		indexes: [],
		foreignKeys: [],
	};

	for (const def of ast.create_definitions ?? []) {
		if (def.resource === "column") {
			readColumnDef(def, table);
		} else if (def.resource === "constraint") {
			readConstraintDef(def, table);
		} else if (def.resource === "index") {
			const cols = defColumns(def.definition);
			if (cols.length) {
				table.indexes.push({
					name: def.index ?? `index(${cols.join(", ")})`,
					columns: cols,
					unique: false,
					origin: "index",
				});
			}
		}
	}

	return table;
}

function applyCreateIndex(schema: SchemaModel, ast: MyAst): void {
	const onTable = tableNameOf(ast.table);
	if (!onTable) return;
	const table = ensureTable(schema, onTable);
	const cols = (ast.index_columns ?? ast.columns ?? [])
		.map((c: MyAst) => c.column ?? c.expr?.column ?? "")
		.filter(Boolean);
	if (!cols.length) return;
	const unique = String(ast.index_type ?? ast.keyword ?? "")
		.toLowerCase()
		.includes("unique");
	table.indexes.push({
		name: ast.index ?? `index(${cols.join(", ")})`,
		columns: cols,
		unique,
		origin: unique ? "unique" : "index",
	});
	if (unique) table.uniques.push(cols);
}

function applyAlterTable(schema: SchemaModel, ast: MyAst): void {
	const onTable = tableNameOf(ast.table);
	if (!onTable) return;
	const table = ensureTable(schema, onTable);
	for (const expr of ast.expr ?? []) {
		if (expr.action !== "add") continue;
		const resource = String(expr.resource ?? "").toLowerCase();
		const cols = defColumns(expr.definition);
		if (resource === "constraint" || expr.create_definitions) {
			const inner = expr.create_definitions ?? expr;
			readConstraintDef(inner, table);
		} else if (resource === "index" || resource === "key") {
			if (cols.length) {
				table.indexes.push({
					name: expr.index ?? `index(${cols.join(", ")})`,
					columns: cols,
					unique: false,
					origin: "index",
				});
			}
		}
	}
}

export function extractMysqlSchema(schema: SchemaModel, input: string): void {
	const ast = parser.astify(input, { database: "mysql" });
	const statements = Array.isArray(ast) ? ast : [ast];
	for (const stmt of statements as MyAst[]) {
		if (stmt.type !== "create" && stmt.type !== "alter") continue;
		const keyword = String(stmt.keyword ?? "").toLowerCase();
		if (stmt.type === "create" && keyword === "table") {
			upsertTable(schema, buildTable(stmt));
		} else if (stmt.type === "create" && keyword === "index") {
			applyCreateIndex(schema, stmt);
		} else if (stmt.type === "alter") {
			applyAlterTable(schema, stmt);
		}
	}
	for (const table of schema.tables.values()) synthesizeKeyIndexes(table);
}
