import type { PlanNode } from "./types";

export function explainNode(node: PlanNode): string {
	if (node.database === "mysql") return explainMysqlNode(node);
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
	if (node.database === "mysql") {
		if (type.includes("loop")) return "join";
		if (
			type.includes("scan") ||
			type.includes("lookup") ||
			type.includes("table")
		)
			return "scan";
		if (type.includes("ordering") || node.usingFilesort) return "sort";
		if (type.includes("group") || type.includes("duplicates"))
			return "aggregate";
		return "other";
	}
	if (type.includes("join") || type === "nested loop") return "join";
	if (type.includes("scan")) return "scan";
	if (type.includes("sort")) return "sort";
	if (type.includes("aggregate") || type.includes("group")) return "aggregate";
	if (type.includes("gather") || node.parallelAware) return "parallel";
	if (/insert|update|delete|modify/.test(type)) return "write";
	return "other";
}

function explainMysqlNode(node: PlanNode): string {
	const target = node.tableName ? ` ${node.tableName}` : "";
	switch (node.accessType) {
		case "ALL":
			return `Reads table${target} with a full scan. This can be correct when much of the table is needed.`;
		case "range":
			return `Reads an index range${node.key ? ` using ${node.key}` : ""}${target ? ` on ${node.tableName}` : ""}.`;
		case "ref":
			return `Uses a non-unique index lookup${node.key ? ` through ${node.key}` : ""}${target ? ` on ${node.tableName}` : ""}.`;
		case "eq_ref":
			return `Uses a unique index lookup per preceding row${node.key ? ` through ${node.key}` : ""}${target ? ` on ${node.tableName}` : ""}.`;
		case "index":
			return `Scans an index${node.key ? ` (${node.key})` : ""}${target ? ` for ${node.tableName}` : ""}.`;
		case "const":
		case "system":
			return `Treats table${target} as a constant table access.`;
		default:
			break;
	}
	if (node.nodeType === "Nested Loop") {
		return "Shows MySQL's nested-loop input order as normalized by QueryGraph.";
	}
	if (node.usingFilesort) {
		return "Orders rows using an operation where MySQL reports filesort.";
	}
	if (node.usingTemporaryTable) {
		return "Uses an operation where MySQL reports a temporary table.";
	}
	if (node.materializedFromSubquery) {
		return "Represents a MySQL materialized subquery branch.";
	}
	return `Represents MySQL's ${node.nodeType} step and passes its output to its parent.`;
}
