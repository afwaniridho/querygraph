import type {
	AccessMethod,
	AccessPathInfo,
	AnalyzeInput,
} from "#/lib/access-path/types";
import type { IndexSchema } from "#/lib/schema/schema";
import { getTable, normalizeIdent } from "#/lib/schema/schema";

interface EqRange {
	equality: Set<string>;
	range: Set<string>;
	defeats: string[];
}

function ident(v: string): string {
	return normalizeIdent(v);
}

interface Ctx {
	alias: string;
	tableName: string;
	tableCols: Set<string>;
	// True when the query block reads a single table, so any unqualified column
	// must belong to it (even if the user's DDL omitted that column).
	singleTable: boolean;
}

// Decides whether a predicate/ref column constrains this table. Qualified refs
// match by alias/name. Unqualified refs attribute here when this is the only
// table in the block, or when this table's schema actually has the column —
// so a JOIN can't leak table B's bare column onto table A and fake an index hit.
function attributes(
	column: string,
	predTable: string | undefined,
	ctx: Ctx,
): boolean {
	if (predTable) {
		const p = ident(predTable);
		return p === ident(ctx.alias) || p === ident(ctx.tableName);
	}
	return ctx.singleTable || ctx.tableCols.has(ident(column));
}

function collectForTable(input: AnalyzeInput, ctx: Ctx): EqRange {
	const { facts } = input;
	const equality = new Set<string>();
	const range = new Set<string>();
	const defeats: string[] = [];
	for (const pred of facts.predicates) {
		if (!attributes(pred.column, pred.table, ctx)) continue;
		const col = ident(pred.column);
		if (pred.kind === "equality") equality.add(col);
		else if (pred.kind === "range") range.add(col);
		else if (pred.kind === "defeated" && pred.reason) {
			defeats.push(pred.reason);
		}
	}
	return { equality, range, defeats };
}

interface IndexMatch {
	index: IndexSchema;
	eqPrefix: number;
	rangeAfter: boolean;
	score: number;
}

// Longest leading run of index columns covered by equality, plus one trailing
// range column — the classic sargable-prefix rule a B-tree planner applies.
function matchIndex(index: IndexSchema, er: EqRange): IndexMatch {
	let eqPrefix = 0;
	while (
		eqPrefix < index.columns.length &&
		er.equality.has(ident(index.columns[eqPrefix]))
	) {
		eqPrefix++;
	}
	const rangeAfter =
		eqPrefix < index.columns.length &&
		er.range.has(ident(index.columns[eqPrefix]));
	const usable = eqPrefix + (rangeAfter ? 1 : 0);
	const fullEq = eqPrefix === index.columns.length && eqPrefix > 0;
	const score = usable * 10 + (fullEq && index.unique ? 100 : 0);
	return { index, eqPrefix, rangeAfter, score };
}

function isCovering(
	index: IndexSchema,
	input: AnalyzeInput,
	ctx: Ctx,
): boolean {
	if (input.facts.selectStar) return false;
	const { facts } = input;
	const indexCols = new Set(index.columns.map(ident));
	const touched = new Set<string>();
	for (const ref of facts.projectedColumns) {
		if (attributes(ref.column, ref.table, ctx)) touched.add(ident(ref.column));
	}
	for (const pred of facts.predicates) {
		if (attributes(pred.column, pred.table, ctx)) {
			touched.add(ident(pred.column));
		}
	}
	for (const ref of facts.sortColumns) {
		if (attributes(ref.column, ref.table, ctx)) touched.add(ident(ref.column));
	}
	if (touched.size === 0) return false;
	for (const c of touched) if (!indexCols.has(c)) return false;
	// A covering scan only helps when the index also offers a seek point.
	return true;
}

function sortSatisfiedBy(
	index: IndexSchema,
	eqPrefix: number,
	input: AnalyzeInput,
	ctx: Ctx,
): boolean {
	const { facts } = input;
	const sortCols = facts.sortColumns.filter((r) =>
		attributes(r.column, r.table, ctx),
	);
	if (sortCols.length === 0) return false;
	// ORDER BY columns must continue the index from where equality ended.
	for (let i = 0; i < sortCols.length; i++) {
		const idxCol = index.columns[eqPrefix + i];
		if (!idxCol || ident(idxCol) !== ident(sortCols[i].column)) return false;
	}
	return true;
}

function describe(
	method: AccessMethod,
	index: IndexSchema | undefined,
	sortSatisfied: boolean,
): string {
	const name = index ? `\`${index.name}\`` : "no index";
	switch (method) {
		case "pk_lookup":
			return `Reaches at most one row through the primary key ${name}.`;
		case "unique_lookup":
			return `Reaches at most one row through the unique index ${name}.`;
		case "index_seek":
			return `Jumps straight to matching rows using ${name} instead of scanning the whole table.`;
		case "index_range":
			return `Walks a contiguous slice of ${name} for the range condition.`;
		case "covering":
			return `Answered entirely from ${name} — the index holds every column this query touches, so the table itself is never read.${
				sortSatisfied ? " It also returns rows already in order." : ""
			}`;
		case "full_scan":
			return "No usable index for these conditions, so every row is read and tested.";
	}
}

function classify(
	best: IndexMatch | null,
	input: AnalyzeInput,
	er: EqRange,
	ctx: Ctx,
): AccessPathInfo {
	if (!best || best.score === 0) {
		const reason = er.defeats.length
			? `${describe("full_scan", undefined, false)} (${er.defeats[0]})`
			: describe("full_scan", undefined, false);
		return { method: "full_scan", reason };
	}

	const { index, eqPrefix, rangeAfter } = best;
	const fullEq = eqPrefix === index.columns.length;
	const sortSatisfied = sortSatisfiedBy(index, eqPrefix, input, ctx);
	const covering = isCovering(index, input, ctx);

	let method: AccessMethod;
	if (fullEq && index.origin === "primary") method = "pk_lookup";
	else if (fullEq && index.unique) method = "unique_lookup";
	else if (covering) method = "covering";
	else if (rangeAfter && eqPrefix === 0) method = "index_range";
	else if (rangeAfter) method = "index_range";
	else method = "index_seek";

	return {
		method,
		index: index.name,
		reason: describe(method, index, sortSatisfied),
		sortSatisfied: sortSatisfied || undefined,
	};
}

// Returns undefined (no annotation) when the table isn't in the schema, so
// queries over unknown tables render exactly as they did before DDL existed.
export function analyzeTableAccess(
	input: AnalyzeInput,
): AccessPathInfo | undefined {
	const table = getTable(input.schema, input.tableName);
	if (!table) return undefined;

	const ctx: Ctx = {
		alias: input.alias,
		tableName: input.tableName,
		tableCols: new Set(table.columns.map((c) => ident(c.name))),
		singleTable: input.facts.aliasToTable.size <= 1,
	};

	const er = collectForTable(input, ctx);
	let best: IndexMatch | null = null;
	for (const index of table.indexes) {
		if (!index.columns.length) continue;
		const m = matchIndex(index, er);
		if (!best || m.score > best.score) best = m;
	}

	return classify(best, input, er, ctx);
}
