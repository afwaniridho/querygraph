export interface ColumnSchema {
	name: string;
	type: string;
	notNull: boolean;
}

export interface IndexSchema {
	name: string;
	// Column order matters: leftmost-prefix matching depends on it.
	columns: string[];
	unique: boolean;
	origin: "primary" | "unique" | "index";
}

export interface ForeignKey {
	columns: string[];
	refTable: string;
	refColumns: string[];
}

export interface TableSchema {
	name: string;
	columns: ColumnSchema[];
	primaryKey: string[];
	uniques: string[][];
	// Includes synthesized PK/unique indexes; `origin` marks which.
	indexes: IndexSchema[];
	foreignKeys: ForeignKey[];
}

// Map keys are normalized (lower-cased, unquoted); use getTable, not direct indexing.
export interface SchemaModel {
	tables: Map<string, TableSchema>;
}

export function emptySchema(): SchemaModel {
	return { tables: new Map() };
}

export function isSchemaEmpty(schema: SchemaModel | undefined | null): boolean {
	return !schema || schema.tables.size === 0;
}

export function normalizeIdent(name: string): string {
	return name
		.trim()
		.replace(/^["`']|["`']$/g, "")
		.toLowerCase();
}

export function getTable(
	schema: SchemaModel | undefined | null,
	name: string,
): TableSchema | undefined {
	if (!schema || !name) return undefined;
	return schema.tables.get(normalizeIdent(name));
}

// Upserts so a later ALTER/CREATE INDEX augments an earlier CREATE TABLE.
export function upsertTable(
	schema: SchemaModel,
	table: TableSchema,
): TableSchema {
	const key = normalizeIdent(table.name);
	const existing = schema.tables.get(key);
	if (!existing) {
		schema.tables.set(key, table);
		return table;
	}
	// Merge: columns/keys/indexes/FKs accumulate.
	existing.columns.push(...table.columns);
	if (table.primaryKey.length) existing.primaryKey = table.primaryKey;
	existing.uniques.push(...table.uniques);
	existing.indexes.push(...table.indexes);
	existing.foreignKeys.push(...table.foreignKeys);
	return existing;
}

// Creates an empty shell so a forward-referencing ALTER/CREATE INDEX still records keys.
export function ensureTable(schema: SchemaModel, name: string): TableSchema {
	const key = normalizeIdent(name);
	let t = schema.tables.get(key);
	if (!t) {
		t = {
			name,
			columns: [],
			primaryKey: [],
			uniques: [],
			indexes: [],
			foreignKeys: [],
		};
		schema.tables.set(key, t);
	}
	return t;
}

// Folds PK/unique constraints into `indexes` so the analyzer scans one list.
export function synthesizeKeyIndexes(table: TableSchema): void {
	if (table.primaryKey.length) {
		const already = table.indexes.some((i) => i.origin === "primary");
		if (!already) {
			table.indexes.unshift({
				name: "PRIMARY",
				columns: [...table.primaryKey],
				unique: true,
				origin: "primary",
			});
		}
	}
	for (const cols of table.uniques) {
		const exists = table.indexes.some(
			(i) =>
				i.origin === "unique" &&
				i.columns.length === cols.length &&
				i.columns.every(
					(c, idx) => normalizeIdent(c) === normalizeIdent(cols[idx]),
				),
		);
		if (!exists) {
			table.indexes.push({
				name: `unique(${cols.join(", ")})`,
				columns: [...cols],
				unique: true,
				origin: "unique",
			});
		}
	}
}
