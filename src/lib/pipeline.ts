import { type Edge, MarkerType, type Node } from "@xyflow/react";
import dagre from "dagre";
import type React from "react";
import {
	type AccessPathInfo,
	analyzeTableAccess,
	type BlockFacts,
} from "#/lib/access-path";
import type { Dialect } from "#/lib/dialect";
import type { SchemaModel } from "#/lib/schema/schema";

export interface SourceSpan {
	start: number;
	end: number;
}

export interface FlowResult {
	nodes: Node[];
	edges: Edge[];
}

/** Computes the one-line prose for a node, used both for layout height and display. */
export type Narrator = (
	kind: string,
	label: string,
	access?: AccessPathInfo,
) => string;

const CARD_WIDTH = 248;
const MIN_CARD_HEIGHT = 96;

const hueByKind: Record<string, string> = {
	table: "var(--color-node-source)",
	insert_target: "var(--color-node-source)",
	create: "var(--color-node-source)",
	column: "var(--color-node-source)",
	join: "var(--color-node-join)",
	straight_join: "var(--color-node-join)",
	cte: "var(--color-node-join)",
	where: "var(--color-node-filter)",
	having: "var(--color-node-filter)",
	select: "var(--color-node-shape)",
	distinct_on: "var(--color-node-shape)",
	operation: "var(--color-node-shape)",
	groupby: "var(--color-node-sort)",
	orderby: "var(--color-node-sort)",
	union: "var(--color-node-sort)",
	values: "var(--color-node-sort)",
	insert: "var(--color-node-write)",
	insert_ignore: "var(--color-node-write)",
	replace: "var(--color-node-write)",
	on_duplicate_key: "var(--color-node-write)",
	on_conflict: "var(--color-node-write)",
	update: "var(--color-node-write)",
	multi_table_update: "var(--color-node-write)",
	delete: "var(--color-node-write)",
	multi_table_delete: "var(--color-node-write)",
	set: "var(--color-node-filter)",
	limit: "var(--color-node-meta)",
	returning: "var(--color-node-meta)",
	index_hint: "var(--color-node-meta)",
};

const EDGE_STROKE = "#6b6357";
const RECURSIVE_STROKE = "#1f6b6b";

function colorFor(kind: string): string {
	return hueByKind[kind] ?? "var(--color-node-shape)";
}

function estimateHeight(prose: string): number {
	const charsPerLine = 30;
	const headerBlock = 52;
	const lines = Math.max(1, Math.ceil(prose.length / charsPerLine));
	return Math.max(MIN_CARD_HEIGHT, headerBlock + lines * 17 + 16);
}

interface DraftNode {
	id: string;
	label: string;
	kind: string;
	loc?: SourceSpan;
	access?: AccessPathInfo;
}

interface DraftEdge {
	source: string;
	target: string;
	kind: string;
	recursive?: boolean;
}

export class Pipeline {
	private drafts: DraftNode[] = [];
	private links: DraftEdge[] = [];
	private counter = 0;
	private readonly sql: string;
	private readonly narrate: Narrator;
	readonly schema?: SchemaModel;
	readonly dialect: Dialect;

	constructor(
		sql: string,
		narrate: Narrator,
		dialect: Dialect,
		schema?: SchemaModel,
	) {
		this.sql = sql;
		this.narrate = narrate;
		this.dialect = dialect;
		this.schema = schema;
	}

	get size(): number {
		return this.drafts.length;
	}

	get source(): string {
		return this.sql;
	}

	// Returns an access annotation for a table, or undefined when no schema is
	// active or the table is unknown — keeping schemaless behavior unchanged.
	accessFor(
		tableName: string,
		alias: string,
		facts: BlockFacts,
	): AccessPathInfo | undefined {
		if (!this.schema) return undefined;
		return analyzeTableAccess({
			alias,
			tableName,
			facts,
			schema: this.schema,
			dialect: this.dialect,
		});
	}

	push(
		label: string,
		kind: string,
		loc?: SourceSpan,
		access?: AccessPathInfo,
	): string {
		const id = `q${this.counter++}`;
		this.drafts.push({ id, label, kind, loc, access });
		return id;
	}

	connect(source: string, target: string, kind = "flow", recursive?: boolean) {
		this.links.push({ source, target, kind, recursive });
	}

	/**
	 * Walks backward from a known offset to anchor a span on a keyword. This is
	 * the proven PG heuristic; the MySQL adapter relies on the same idea through
	 * `locateClause` because node-sql-parser lacks per-clause offsets.
	 */
	withKeyword(
		loc: SourceSpan | undefined,
		keyword: string,
	): SourceSpan | undefined {
		if (!loc) return undefined;
		const kw = keyword.toUpperCase();
		const from = Math.max(0, loc.start - kw.length - 24);
		const window = this.sql.substring(from, loc.start).toUpperCase();
		const idx = window.lastIndexOf(kw);
		return idx >= 0 ? { start: from + idx, end: loc.end } : loc;
	}

	withAlias(
		loc: SourceSpan | undefined,
		alias?: string,
	): SourceSpan | undefined {
		if (!loc || !alias) return loc;
		const to = Math.min(loc.end + alias.length + 12, this.sql.length);
		const window = this.sql.substring(loc.end, to);
		const idx = window.indexOf(alias);
		return idx >= 0
			? { start: loc.start, end: loc.end + idx + alias.length }
			: loc;
	}

	render(): FlowResult {
		if (this.drafts.length === 0) return { nodes: [], edges: [] };

		const g = new dagre.graphlib.Graph();
		g.setGraph({
			rankdir: "TB",
			nodesep: 44,
			ranksep: 116,
			marginx: 48,
			marginy: 48,
		});
		g.setDefaultEdgeLabel(() => ({}));

		const meta = new Map<
			string,
			{ prose: string; height: number; order: number }
		>();
		this.drafts.forEach((d, i) => {
			const prose = this.narrate(d.kind, d.label, d.access);
			const height = estimateHeight(prose);
			meta.set(d.id, { prose, height, order: i });
			g.setNode(d.id, { width: CARD_WIDTH, height });
		});

		for (const link of this.links) {
			if (!link.recursive) g.setEdge(link.source, link.target);
		}

		dagre.layout(g);

		const rightmost = Math.max(
			...this.drafts.map((d) => g.node(d.id).x + CARD_WIDTH / 2),
		);

		const flowNodes: Node[] = this.drafts.map((d) => {
			const pos = g.node(d.id);
			const info = meta.get(d.id);
			if (!info) throw new Error(`missing layout meta for ${d.id}`);
			return {
				id: d.id,
				type: "sql",
				position: { x: pos.x - CARD_WIDTH / 2, y: pos.y - info.height / 2 },
				data: {
					label: d.label,
					loc: d.loc,
					kind: d.kind,
					prose: info.prose,
					step: info.order + 1,
					access: d.access,
				},
				style: {
					"--node-hue": colorFor(d.kind),
					width: CARD_WIDTH,
				} as React.CSSProperties,
			};
		});

		const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14 };

		const flowEdges: Edge[] = this.links.map((link, i) => {
			if (link.recursive) {
				const src = g.node(link.source);
				const tgt = g.node(link.target);
				return {
					id: `e${i}`,
					source: link.source,
					target: link.target,
					type: "recursive",
					animated: true,
					markerEnd: { ...arrow, color: RECURSIVE_STROKE },
					data: {
						fromX: src.x + CARD_WIDTH / 2,
						fromY: src.y,
						toX: tgt.x + CARD_WIDTH / 2,
						toY: tgt.y,
						loopX: rightmost + 88,
					},
					style: {
						stroke: RECURSIVE_STROKE,
						strokeDasharray: "5 5",
						strokeWidth: 1.75,
					},
				};
			}
			return {
				id: `e${i}`,
				source: link.source,
				target: link.target,
				animated: true,
				markerEnd: { ...arrow, color: EDGE_STROKE },
				style: { stroke: EDGE_STROKE, strokeWidth: 1.5 },
			};
		});

		return { nodes: flowNodes, edges: flowEdges };
	}
}
