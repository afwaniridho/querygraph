import { estimateRatio, formatNumber, totalActualTime } from "./metrics";
import type { ExecutionPlan, PlanNode } from "./types";

export type PlanBottleneckKind =
	| "actual-time"
	| "loop-aware-time"
	| "cardinality-mismatch"
	| "rows-removed"
	| "temp-io"
	| "estimated-cost"
	| "estimated-rows";

export interface PlanBottleneckItem {
	kind: PlanBottleneckKind;
	nodeId: string;
	nodeType: string;
	label?: string;
	value: number;
	displayValue: string;
	evidence: string;
}

export interface PlanBottleneckSection {
	kind: PlanBottleneckKind;
	title: string;
	description: string;
	items: PlanBottleneckItem[];
}

const SECTION_LIMIT = 3;

const nodeLabel = (node: PlanNode) =>
	node.relationName ??
	node.tableName ??
	node.indexName ??
	node.key ??
	node.alias ??
	node.parentRelationship;

const item = (
	node: PlanNode,
	value: number,
	valueSuffix: string,
	kind: PlanBottleneckKind,
	evidence: string,
): PlanBottleneckItem => ({
	kind,
	nodeId: node.id,
	nodeType: node.nodeType,
	label: nodeLabel(node),
	value,
	displayValue: `${formatNumber(value)}${valueSuffix}`,
	evidence,
});

const top = (items: PlanBottleneckItem[]) =>
	items
		.filter(
			(candidate) => !Number.isNaN(candidate.value) && candidate.value > 0,
		)
		.sort(
			(a, b) =>
				b.value - a.value ||
				a.nodeType.localeCompare(b.nodeType) ||
				a.nodeId.localeCompare(b.nodeId),
		)
		.slice(0, SECTION_LIMIT);

const section = (
	kind: PlanBottleneckKind,
	title: string,
	description: string,
	items: PlanBottleneckItem[],
): PlanBottleneckSection | null => {
	const ranked = top(items);
	return ranked.length ? { kind, title, description, items: ranked } : null;
};

function tempIoScore(node: PlanNode) {
	const tempBlocks = (node.temp?.read ?? 0) + (node.temp?.written ?? 0);
	const diskSort =
		node.sortMethod?.toLowerCase().includes("external") ||
		node.sortSpaceType?.toLowerCase() === "disk";
	const sortDiskKb = diskSort ? (node.sortSpaceUsed ?? 1) : 0;
	const hashBatches = Math.max(node.hashBatches ?? 1, 1);
	const hashBatchScore = hashBatches > 1 ? hashBatches - 1 : 0;
	const score = tempBlocks + sortDiskKb + hashBatchScore;
	if (score <= 0) return undefined;

	const parts: string[] = [];
	if (tempBlocks) {
		parts.push(
			`${formatNumber(tempBlocks)} temp blocks (${formatNumber(node.temp?.read ?? 0)} read, ${formatNumber(node.temp?.written ?? 0)} written)`,
		);
	}
	if (diskSort) {
		parts.push(
			`${node.sortMethod ?? "Disk sort"}${node.sortSpaceUsed !== undefined ? ` · ${formatNumber(node.sortSpaceUsed)} kB ${node.sortSpaceType ?? ""}` : ""}`,
		);
	}
	if (hashBatches > 1) {
		parts.push(`${formatNumber(hashBatches)} hash batches`);
	}
	return { score, evidence: parts.join(" · ") };
}

function estimatedCost(node: PlanNode) {
	return node.totalCost ?? node.queryCost ?? node.prefixCost ?? node.readCost;
}

function estimatedRows(node: PlanNode) {
	return node.planRows ?? node.rowsProducedPerJoin ?? node.rowsExaminedPerScan;
}

export function rankPlanBottlenecks(
	plan: ExecutionPlan,
): PlanBottleneckSection[] {
	const sections: Array<PlanBottleneckSection | null> = [];

	if (plan.database === "postgresql" && plan.analyzed) {
		sections.push(
			section(
				"actual-time",
				"Top actual time nodes",
				"Inclusive time reported on each node.",
				plan.nodes.map((node) =>
					item(
						node,
						node.actualTotalTime ?? 0,
						" ms",
						"actual-time",
						`${formatNumber(node.actualTotalTime ?? 0)} ms inclusive time per loop${(node.actualLoops ?? 1) > 1 ? ` across ${formatNumber(node.actualLoops ?? 1)} loops` : ""}.`,
					),
				),
			),
			section(
				"loop-aware-time",
				"Top loop-aware repeated work",
				"Derived from inclusive time per loop multiplied by loops.",
				plan.nodes.map((node) => {
					const loops = node.actualLoops ?? 1;
					const value = loops > 1 ? (totalActualTime(node) ?? 0) : 0;
					return item(
						node,
						value,
						" ms",
						"loop-aware-time",
						`${formatNumber(node.actualTotalTime ?? 0)} ms inclusive time × ${formatNumber(loops)} loops = ${formatNumber(value)} ms loop-aware inclusive work.`,
					);
				}),
			),
			section(
				"cardinality-mismatch",
				"Largest cardinality mismatches",
				"Estimated rows compared with actual rows per loop.",
				plan.nodes.map((node) => {
					const ratio = estimateRatio(node) ?? 0;
					return item(
						node,
						ratio > 1 ? ratio : 0,
						"×",
						"cardinality-mismatch",
						`${formatNumber(node.planRows ?? 0)} estimated vs ${formatNumber(node.actualRows ?? 0)} actual rows per loop.`,
					);
				}),
			),
			section(
				"rows-removed",
				"Largest rows removed",
				"Rows removed by filter or join filter.",
				plan.nodes.map((node) => {
					const filterRows = node.rowsRemovedByFilter ?? 0;
					const joinRows = node.rowsRemovedByJoinFilter ?? 0;
					return item(
						node,
						filterRows + joinRows,
						" rows",
						"rows-removed",
						`${formatNumber(filterRows)} by filter · ${formatNumber(joinRows)} by join filter.`,
					);
				}),
			),
			section(
				"temp-io",
				"Largest temp I/O, disk sort, or hash batching",
				"Temporary blocks, disk-backed sorts, and multi-batch hash operations.",
				plan.nodes.map((node) => {
					const temp = tempIoScore(node);
					return item(
						node,
						temp?.score ?? 0,
						"",
						"temp-io",
						temp?.evidence ?? "",
					);
				}),
			),
		);
	} else {
		sections.push(
			section(
				"estimated-cost",
				"Top planner cost nodes",
				"Estimated optimizer cost. Estimated cost is not milliseconds.",
				plan.nodes.map((node) =>
					item(
						node,
						estimatedCost(node) ?? 0,
						"",
						"estimated-cost",
						plan.database === "mysql"
							? `Estimated cost from query_cost, prefix_cost, or read_cost: ${formatNumber(estimatedCost(node) ?? 0)}.`
							: `Estimated cost ${formatNumber(node.startupCost ?? 0)}..${formatNumber(node.totalCost ?? 0)} planner units.`,
					),
				),
			),
			section(
				"estimated-rows",
				"Highest estimated rows",
				"Estimated rows from the planner or optimizer.",
				plan.nodes.map((node) =>
					item(
						node,
						estimatedRows(node) ?? 0,
						" rows",
						"estimated-rows",
						plan.database === "mysql"
							? `${formatNumber(node.rowsExaminedPerScan ?? 0)} rows examined per scan · ${formatNumber(node.rowsProducedPerJoin ?? 0)} rows produced per join.`
							: `${formatNumber(node.planRows ?? 0)} estimated rows.`,
					),
				),
			),
		);
	}

	return sections.filter((candidate): candidate is PlanBottleneckSection =>
		Boolean(candidate),
	);
}
