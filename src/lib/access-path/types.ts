import type { Dialect } from "#/lib/dialect";
import type { SchemaModel } from "#/lib/schema/schema";

export type AccessMethod =
	| "pk_lookup"
	| "unique_lookup"
	| "index_seek"
	| "index_range"
	| "covering"
	| "full_scan";

// Attached to a table node's data when a schema is active and the table is known.
export interface AccessPathInfo {
	method: AccessMethod;
	index?: string;
	reason: string;
	// True when the chosen index also satisfies the block's ORDER BY / GROUP BY.
	sortSatisfied?: boolean;
}

export type PredicateKind = "equality" | "range" | "defeated";

export interface ColumnPredicate {
	// Table qualifier as written (alias or name); undefined when unqualified.
	table?: string;
	column: string;
	kind: PredicateKind;
	// For defeated predicates: why the column can't use an index.
	reason?: string;
}

export interface ColumnRef {
	table?: string;
	column: string;
}

// Everything the analyzer needs about one query block (one SELECT/UPDATE/DELETE).
export interface BlockFacts {
	// alias (normalized) -> real table name (normalized)
	aliasToTable: Map<string, string>;
	predicates: ColumnPredicate[];
	sortColumns: ColumnRef[];
	projectedColumns: ColumnRef[];
	selectStar: boolean;
}

export interface AnalyzeInput {
	alias: string;
	tableName: string;
	facts: BlockFacts;
	schema: SchemaModel;
	dialect: Dialect;
}

export function emptyFacts(): BlockFacts {
	return {
		aliasToTable: new Map(),
		predicates: [],
		sortColumns: [],
		projectedColumns: [],
		selectStar: false,
	};
}
