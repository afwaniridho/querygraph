import { isMysqlTreeOutput, parseMysqlTreePlan } from "./mysql-tree-parser";
import { normalizeMysqlExplainInput } from "./normalize-input";
import { PLAN_LIMITS } from "./parser";
import {
	type ExecutionPlan,
	type ParseLimits,
	type PlanNode,
	PlanParseError,
} from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
	typeof value === "string" ? value : undefined;
const bool = (value: unknown) =>
	typeof value === "boolean" ? value : undefined;
const number = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
};
const texts = (value: unknown) =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string"
			? [value]
			: undefined;

type ChildCandidate = {
	raw: Record<string, unknown>;
	nodeType: string;
	parentRelationship?: string;
	normalized?: boolean;
};

type Frame = ChildCandidate & {
	parentId: string | null;
	depth: number;
	path: number[];
};

function findTreeExplainText(input: string): string | undefined {
	try {
		const parsed = JSON.parse(input) as unknown;
		if (typeof parsed === "string" && isMysqlTreeOutput(parsed)) {
			return parsed;
		}
		if (
			Array.isArray(parsed) &&
			parsed.length === 1 &&
			object(parsed[0]) &&
			typeof parsed[0].EXPLAIN === "string" &&
			isMysqlTreeOutput(parsed[0].EXPLAIN)
		) {
			return parsed[0].EXPLAIN;
		}
		if (
			object(parsed) &&
			typeof parsed.EXPLAIN === "string" &&
			isMysqlTreeOutput(parsed.EXPLAIN)
		) {
			return parsed.EXPLAIN;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function findQueryBlock(value: unknown): Record<string, unknown> | undefined {
	if (!object(value)) return undefined;
	if (object(value.query_block)) return value.query_block;
	const entries = Object.values(value).filter(object);
	if (entries.length === 1 && object(entries[0].query_block)) {
		return entries[0].query_block;
	}
	return undefined;
}

function costInfo(raw: Record<string, unknown>) {
	return object(raw.cost_info) ? raw.cost_info : undefined;
}

function mysqlNodeType(raw: Record<string, unknown>, fallback: string): string {
	if (object(raw.table)) return mysqlNodeType(raw.table, fallback);
	if (object(raw.query_block)) return "Query Block";
	if (object(raw.nested_loop)) return "Nested Loop";
	if (object(raw.grouping_operation)) return "Grouping Operation";
	if (object(raw.ordering_operation)) return "Ordering Operation";
	if (object(raw.duplicates_removal)) return "Duplicates Removal";
	if (object(raw.union_result)) return "Union Result";
	if (object(raw.materialized_from_subquery)) return "Materialized Subquery";
	if (object(raw.dependent)) return "Dependent Subquery";
	if (raw.select_id !== undefined) return `Select #${raw.select_id}`;
	if (raw.table_name !== undefined)
		return tableAccessType(text(raw.access_type));
	return fallback;
}

function tableAccessType(accessType?: string): string {
	switch (accessType) {
		case "ALL":
			return "Table Scan";
		case "index":
			return "Index Scan";
		case "range":
			return "Range Scan";
		case "ref":
			return "Ref Lookup";
		case "eq_ref":
			return "Unique Ref Lookup";
		case "const":
		case "system":
			return "Const Table";
		default:
			return "Table Access";
	}
}

function unwrap(candidate: unknown, relationship?: string): ChildCandidate[] {
	if (!object(candidate)) return [];
	if (object(candidate.table)) {
		return [
			{
				raw: candidate.table,
				nodeType: tableAccessType(text(candidate.table.access_type)),
				parentRelationship: relationship,
			},
		];
	}
	for (const key of [
		"query_block",
		"grouping_operation",
		"ordering_operation",
		"duplicates_removal",
		"union_result",
		"materialized_from_subquery",
	] as const) {
		if (object(candidate[key])) {
			return [
				{
					raw: candidate[key],
					nodeType: mysqlNodeType({ [key]: candidate[key] }, "Operation"),
					parentRelationship: relationship,
				},
			];
		}
	}
	if (Array.isArray(candidate.nested_loop)) {
		return [
			{
				raw: { nested_loop: candidate.nested_loop },
				nodeType: "Nested Loop",
				parentRelationship: relationship,
				normalized: true,
			},
		];
	}
	return [
		{
			raw: candidate,
			nodeType: mysqlNodeType(candidate, "Operation"),
			parentRelationship: relationship,
		},
	];
}

function operationChildren(raw: Record<string, unknown>): ChildCandidate[] {
	const children: ChildCandidate[] = [];
	const push = (value: unknown, relationship?: string) => {
		for (const child of unwrap(value, relationship)) children.push(child);
	};

	if (Array.isArray(raw.nested_loop)) {
		if (raw.querygraph_normalized_nested_loop) {
			raw.nested_loop.forEach((item, index) => {
				push(item, index === 0 ? "outer input" : `inner input ${index}`);
			});
		} else {
			children.push({
				raw: {
					nested_loop: raw.nested_loop,
					querygraph_normalized_nested_loop: true,
				},
				nodeType: "Nested Loop",
				normalized: true,
			});
		}
	}
	if (Array.isArray(raw.query_specifications)) {
		raw.query_specifications.forEach((item, index) => {
			push(item, `query specification ${index + 1}`);
		});
	}
	for (const key of [
		"table",
		"grouping_operation",
		"ordering_operation",
		"duplicates_removal",
		"union_result",
		"query_block",
	] as const) {
		if (object(raw[key])) push({ [key]: raw[key] });
	}
	if (object(raw.materialized_from_subquery)) {
		push(
			{ materialized_from_subquery: raw.materialized_from_subquery },
			"materialized subquery",
		);
	}
	if (Array.isArray(raw.attached_subqueries)) {
		raw.attached_subqueries.forEach((item, index) => {
			push(item, `attached subquery ${index + 1}`);
		});
	}
	if (Array.isArray(raw.dependent_subqueries)) {
		raw.dependent_subqueries.forEach((item, index) => {
			push(item, `dependent subquery ${index + 1}`);
		});
	}
	return children;
}

function normalizeNode(frame: Frame, childIds: string[]): PlanNode {
	const raw = frame.raw;
	const costs = costInfo(raw);
	return {
		id: `plan-${frame.path.join("-")}`,
		parentId: frame.parentId,
		childIds,
		depth: frame.depth,
		database: "mysql",
		nodeType: frame.nodeType,
		parentRelationship: frame.parentRelationship,
		relationName: text(raw.table_name),
		alias: text(raw.table_name),
		filter: text(raw.attached_condition),
		startupCost: undefined,
		totalCost: number(costs?.prefix_cost) ?? number(costs?.query_cost),
		planRows:
			number(raw.rows_produced_per_join) ?? number(raw.rows_examined_per_scan),
		workers: [],
		tableName: text(raw.table_name),
		accessType: text(raw.access_type),
		possibleKeys: texts(raw.possible_keys),
		key: text(raw.key),
		usedKeyParts: texts(raw.used_key_parts),
		keyLength: text(raw.key_length),
		ref: texts(raw.ref),
		rowsExaminedPerScan: number(raw.rows_examined_per_scan),
		rowsProducedPerJoin: number(raw.rows_produced_per_join),
		filtered: number(raw.filtered),
		attachedCondition: text(raw.attached_condition),
		usingIndex: bool(raw.using_index),
		usingTemporaryTable: bool(raw.using_temporary_table),
		usingFilesort: bool(raw.using_filesort),
		readCost: number(costs?.read_cost),
		evalCost: number(costs?.eval_cost),
		prefixCost: number(costs?.prefix_cost),
		dataReadPerJoin: text(costs?.data_read_per_join),
		queryCost: number(costs?.query_cost),
		usedColumns: texts(raw.used_columns),
		materializedFromSubquery: object(raw.materialized_from_subquery),
		normalized: frame.normalized,
		raw: { ...raw },
	};
}

export function parseMysqlPlan(
	input: string,
	limits: ParseLimits = PLAN_LIMITS,
): ExecutionPlan {
	if (!input.trim()) {
		throw new PlanParseError("empty", "Paste MySQL EXPLAIN to begin.");
	}
	if (isMysqlTreeOutput(input)) {
		return parseMysqlTreePlan(input, limits);
	}
	if (new TextEncoder().encode(input).byteLength > limits.maxInputBytes) {
		throw new PlanParseError(
			"too-large",
			`This MySQL plan exceeds the ${Math.round(limits.maxInputBytes / 1_000_000)} MB input limit.`,
		);
	}
	const treeText = findTreeExplainText(input);
	if (treeText) {
		return parseMysqlTreePlan(treeText, limits);
	}
	const parsed = normalizeMysqlExplainInput(input);
	if (typeof parsed === "string") {
		throw new PlanParseError(
			"invalid-structure",
			"MySQL text or TREE EXPLAIN output is not supported; paste JSON from EXPLAIN FORMAT=JSON.",
		);
	}
	const queryBlock = findQueryBlock(parsed);
	if (!queryBlock) {
		throw new PlanParseError(
			"missing-plan",
			"The JSON is valid, but it does not contain a MySQL query_block root.",
		);
	}

	const nodes: PlanNode[] = [];
	const stack: Frame[] = [
		{
			raw: queryBlock,
			nodeType: mysqlNodeType(queryBlock, "Query Block"),
			parentId: null,
			depth: 0,
			path: [0],
		},
	];

	while (stack.length) {
		const current = stack.pop();
		if (!current) break;
		if (current.depth > limits.maxDepth) {
			throw new PlanParseError(
				"too-deep",
				`This MySQL plan exceeds the maximum depth of ${limits.maxDepth}.`,
			);
		}
		if (nodes.length >= limits.maxNodes) {
			throw new PlanParseError(
				"too-many-nodes",
				`This MySQL plan exceeds the ${limits.maxNodes}-node limit.`,
			);
		}
		const id = `plan-${current.path.join("-")}`;
		const children = operationChildren(current.raw);
		const childIds = children.map((_, index) => `${id}-${index}`);
		nodes.push(normalizeNode(current, childIds));
		for (let index = children.length - 1; index >= 0; index--) {
			stack.push({
				...children[index],
				parentId: id,
				depth: current.depth + 1,
				path: [...current.path, index],
			});
		}
	}

	const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
	return {
		database: "mysql",
		rootId: "plan-0",
		nodes,
		nodeById,
		maxDepth: Math.max(...nodes.map((node) => node.depth)),
		analyzed: nodes.some((node) => node.actualRows !== undefined),
		hasBuffers: false,
		triggers: [],
		raw: object(parsed) ? { ...parsed } : { query_block: queryBlock },
	};
}
