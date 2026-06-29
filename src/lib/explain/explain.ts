import type { PlanNode } from "./types";

export function explainNode(node: PlanNode): string {
	const target = node.relationName
		? ` on ${node.schema ? `${node.schema}.` : ""}${node.relationName}`
		: "";
	if (node.nodeType.includes("Index")) {
		return `Reads matching rows${target} using ${node.indexName ? `the ${node.indexName} index` : "an index access path"}.`;
	}
	if (node.nodeType === "Seq Scan") {
		return `Reads the relation${target} sequentially. This can be optimal when much of the relation is needed.`;
	}
	if (node.nodeType.includes("Join")) {
		return `Combines rows from child operations using a ${node.joinType?.toLowerCase() ?? "join"} ${node.nodeType.toLowerCase()} strategy.`;
	}
	if (node.nodeType.includes("Sort")) {
		return `Orders rows${node.sortKey?.length ? ` by ${node.sortKey.join(", ")}` : ""}.`;
	}
	if (node.nodeType.includes("Aggregate")) {
		return `Combines input rows into aggregate results${node.groupKey?.length ? ` grouped by ${node.groupKey.join(", ")}` : ""}.`;
	}
	if (node.nodeType.includes("Gather")) {
		return "Collects rows produced by parallel workers.";
	}
	return `Performs PostgreSQL's ${node.nodeType} operation and passes its output to its parent.`;
}

export function nodeCategory(node: PlanNode) {
	const type = node.nodeType.toLowerCase();
	if (type.includes("join") || type === "nested loop") return "join";
	if (type.includes("scan")) return "scan";
	if (type.includes("sort")) return "sort";
	if (type.includes("aggregate") || type.includes("group")) return "aggregate";
	if (type.includes("gather") || node.parallelAware) return "parallel";
	if (/insert|update|delete|modify/.test(type)) return "write";
	return "other";
}
