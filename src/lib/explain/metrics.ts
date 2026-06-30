import type { PlanNode } from "./types";

export const totalActualRows = (node: PlanNode) =>
	node.actualRows === undefined
		? undefined
		: node.actualRows * (node.actualLoops ?? 1);

export const totalActualTime = (node: PlanNode) =>
	node.actualTotalTime === undefined
		? undefined
		: node.actualTotalTime * (node.actualLoops ?? 1);

export function estimateRatio(node: PlanNode) {
	if (
		node.planRows === undefined ||
		node.actualRows === undefined ||
		node.planRows < 0 ||
		node.actualRows < 0
	) {
		return undefined;
	}
	const actual = node.actualRows;
	if (actual === 0 && node.planRows === 0) return 1;
	if (actual === 0 || node.planRows === 0) return Number.POSITIVE_INFINITY;
	return Math.max(actual / node.planRows, node.planRows / actual);
}

export function filteringPercent(node: PlanNode, join = false) {
	const removed = join
		? node.rowsRemovedByJoinFilter
		: node.rowsRemovedByFilter;
	const returned = node.actualRows;
	if (removed === undefined || returned === undefined) return undefined;
	const total = removed + returned;
	return total > 0 ? (removed / total) * 100 : undefined;
}

export const formatNumber = (value: number) =>
	new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
