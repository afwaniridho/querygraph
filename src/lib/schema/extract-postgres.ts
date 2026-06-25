import { parse } from "pgsql-ast-parser";
import type { Ast } from "#/lib/expr/postgres";
import {
	type ColumnSchema,
	ensureTable,
	type ForeignKey,
	type SchemaModel,
	synthesizeKeyIndexes,
	type TableSchema,
	upsertTable,
} from "#/lib/schema/schema";

function refName(node: Ast): string {
	if (!node) return "";
	if (typeof node === "string") return node;
	if (typeof node.name === "string") return node.name;
	if (node.name?.name) return node.name.name;
	return "";
}

function colNames(list: Ast[] | undefined): string[] {
	return (list ?? []).map((c) => refName(c)).filter(Boolean);
}

function readColumn(col: Ast): {
	column: ColumnSchema;
	primary: boolean;
	unique: boolean;
	fk?: ForeignKey;
} {
	const name = refName(col.name);
	const type = (col.dataType?.name ?? "").toUpperCase();
	let notNull = false;
	let primary = false;
	let unique = false;
	let fk: ForeignKey | undefined;

	for (const c of col.constraints ?? []) {
		if (c.type === "not null") notNull = true;
		else if (c.type === "primary key") {
			primary = true;
			notNull = true;
		} else if (c.type === "unique") unique = true;
		else if (c.type === "reference") {
			fk = {
				columns: [name],
				refTable: refName(c.foreignTable),
				refColumns: colNames(c.foreignColumns),
			};
		}
	}

	return { column: { name, type, notNull }, primary, unique, fk };
}

function buildTable(ast: Ast): TableSchema {
	const table: TableSchema = {
		name: refName(ast.name),
		columns: [],
		primaryKey: [],
		uniques: [],
		indexes: [],
		foreignKeys: [],
	};

	for (const col of ast.columns ?? []) {
		if (col.kind !== "column" && !col.name) continue;
		const { column, primary, unique, fk } = readColumn(col);
		table.columns.push(column);
		if (primary) table.primaryKey = [column.name];
		if (unique) table.uniques.push([column.name]);
		if (fk) table.foreignKeys.push(fk);
	}

	for (const c of ast.constraints ?? []) {
		if (c.type === "primary key") {
			table.primaryKey = colNames(c.columns);
		} else if (c.type === "unique") {
			table.uniques.push(colNames(c.columns));
		} else if (c.type === "foreign key") {
			table.foreignKeys.push({
				columns: colNames(c.localColumns),
				refTable: refName(c.foreignTable),
				refColumns: colNames(c.foreignColumns),
			});
		}
	}

	return table;
}

function applyCreateIndex(schema: SchemaModel, ast: Ast): void {
	const tableName = refName(ast.table);
	if (!tableName) return;
	const table = ensureTable(schema, tableName);
	// CREATE INDEX expressions can be bare refs or arbitrary expressions; only
	// plain column refs participate in index matching, so non-refs are dropped.
	const columns = (ast.expressions ?? [])
		.map((e: Ast) => (e.expression?.type === "ref" ? e.expression.name : ""))
		.filter(Boolean);
	if (!columns.length) return;
	table.indexes.push({
		name: refName(ast.indexName) || `index(${columns.join(", ")})`,
		columns,
		unique: ast.unique === true,
		origin: ast.unique === true ? "unique" : "index",
	});
	if (ast.unique === true) table.uniques.push(columns);
}

function applyAlterTable(schema: SchemaModel, ast: Ast): void {
	const tableName = refName(ast.table);
	if (!tableName) return;
	const table = ensureTable(schema, tableName);
	for (const change of ast.changes ?? []) {
		if (change.type !== "add constraint") continue;
		const c = change.constraint;
		if (!c) continue;
		if (c.type === "primary key") {
			table.primaryKey = colNames(c.columns);
		} else if (c.type === "unique") {
			table.uniques.push(colNames(c.columns));
		} else if (c.type === "foreign key") {
			table.foreignKeys.push({
				columns: colNames(c.localColumns),
				refTable: refName(c.foreignTable),
				refColumns: colNames(c.foreignColumns),
			});
		}
	}
}

export function extractPostgresSchema(
	schema: SchemaModel,
	input: string,
): void {
	const statements = parse(input) as Ast[];
	for (const stmt of statements) {
		if (stmt.type === "create table") {
			upsertTable(schema, buildTable(stmt));
		} else if (stmt.type === "create index") {
			applyCreateIndex(schema, stmt);
		} else if (stmt.type === "alter table") {
			applyAlterTable(schema, stmt);
		}
	}
	for (const table of schema.tables.values()) synthesizeKeyIndexes(table);
}
