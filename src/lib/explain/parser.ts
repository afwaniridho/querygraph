import {
	type BlockMetrics,
	type ExecutionPlan,
	type ParseLimits,
	type PlanNode,
	PlanParseError,
	type PlanWorker,
} from "./types";

export const PLAN_LIMITS: ParseLimits = {
	maxInputBytes: 2_000_000,
	maxNodes: 1_000,
	maxDepth: 100,
};

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
	typeof value === "string" ? value : undefined;
const bool = (value: unknown) =>
	typeof value === "boolean" ? value : undefined;
const number = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;
const texts = (value: unknown) =>
	Array.isArray(value) && value.every((item) => typeof item === "string")
		? [...value]
		: undefined;

function blocks(
	raw: Record<string, unknown>,
	prefix: string,
): BlockMetrics | undefined {
	const result = {
		hit: number(raw[`${prefix} Hit Blocks`]),
		read: number(raw[`${prefix} Read Blocks`]),
		dirtied: number(raw[`${prefix} Dirtied Blocks`]),
		written: number(raw[`${prefix} Written Blocks`]),
	};
	return Object.values(result).some((value) => value !== undefined)
		? result
		: undefined;
}

function workers(value: unknown): PlanWorker[] {
	if (!Array.isArray(value)) return [];
	return value.filter(object).map((raw) => ({
		number: number(raw["Worker Number"]),
		actualStartupTime: number(raw["Actual Startup Time"]),
		actualTotalTime: number(raw["Actual Total Time"]),
		actualRows: number(raw["Actual Rows"]),
		actualLoops: number(raw["Actual Loops"]),
		raw: { ...raw },
	}));
}

function normalizeTopLevel(value: unknown): Record<string, unknown> {
	if (Array.isArray(value)) {
		if (value.length !== 1 || !object(value[0])) {
			throw new PlanParseError(
				"invalid-structure",
				"PostgreSQL EXPLAIN JSON must contain one plan object.",
			);
		}
		return value[0];
	}
	if (object(value) && object(value.Plan)) return value;
	if (object(value) && typeof value["Node Type"] === "string") {
		return { Plan: value };
	}
	throw new PlanParseError(
		"invalid-structure",
		"This does not appear to be PostgreSQL EXPLAIN JSON.",
	);
}

export function parsePostgresPlan(
	input: string,
	limits: ParseLimits = PLAN_LIMITS,
): ExecutionPlan {
	if (!input.trim()) {
		throw new PlanParseError(
			"empty",
			"Paste PostgreSQL EXPLAIN JSON to begin.",
		);
	}
	if (new TextEncoder().encode(input).byteLength > limits.maxInputBytes) {
		throw new PlanParseError(
			"too-large",
			`This plan exceeds the ${Math.round(limits.maxInputBytes / 1_000_000)} MB input limit.`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(input);
	} catch (error) {
		throw new PlanParseError(
			"invalid-json",
			"This does not appear to be PostgreSQL EXPLAIN JSON.",
			error instanceof Error ? error.message : undefined,
		);
	}
	const top = normalizeTopLevel(parsed);
	if (!object(top.Plan) || typeof top.Plan["Node Type"] !== "string") {
		throw new PlanParseError(
			"missing-plan",
			"The JSON is valid, but it does not contain a PostgreSQL Plan root.",
		);
	}

	const nodes: PlanNode[] = [];
	const stack: Array<{
		raw: Record<string, unknown>;
		parentId: string | null;
		depth: number;
		path: number[];
	}> = [{ raw: top.Plan, parentId: null, depth: 0, path: [0] }];

	while (stack.length) {
		const current = stack.pop();
		if (!current) break;
		if (current.depth > limits.maxDepth) {
			throw new PlanParseError(
				"too-deep",
				`This plan exceeds the maximum depth of ${limits.maxDepth}.`,
			);
		}
		if (nodes.length >= limits.maxNodes) {
			throw new PlanParseError(
				"too-many-nodes",
				`This plan exceeds the ${limits.maxNodes}-node limit.`,
			);
		}
		const { raw } = current;
		if (typeof raw["Node Type"] !== "string") {
			throw new PlanParseError(
				"invalid-structure",
				"Every plan node must have a Node Type.",
			);
		}
		const id = `plan-${current.path.join("-")}`;
		const children = Array.isArray(raw.Plans) ? raw.Plans.filter(object) : [];
		const childIds = children.map((_, index) => `${id}-${index}`);
		nodes.push({
			id,
			parentId: current.parentId,
			childIds,
			depth: current.depth,
			nodeType: raw["Node Type"],
			parentRelationship: text(raw["Parent Relationship"]),
			joinType: text(raw["Join Type"]),
			scanDirection: text(raw["Scan Direction"]),
			relationName: text(raw["Relation Name"]),
			schema: text(raw.Schema),
			alias: text(raw.Alias),
			indexName: text(raw["Index Name"]),
			hashCondition: text(raw["Hash Cond"]),
			joinFilter: text(raw["Join Filter"]),
			filter: text(raw.Filter),
			indexCondition: text(raw["Index Cond"]),
			recheckCondition: text(raw["Recheck Cond"]),
			sortKey: texts(raw["Sort Key"]),
			sortMethod: text(raw["Sort Method"]),
			groupKey: texts(raw["Group Key"]),
			strategy: text(raw.Strategy),
			operation: text(raw.Operation),
			subplanName: text(raw["Subplan Name"]),
			cteName: text(raw["CTE Name"]),
			startupCost: number(raw["Startup Cost"]),
			totalCost: number(raw["Total Cost"]),
			planRows: number(raw["Plan Rows"]),
			planWidth: number(raw["Plan Width"]),
			actualStartupTime: number(raw["Actual Startup Time"]),
			actualTotalTime: number(raw["Actual Total Time"]),
			actualRows: number(raw["Actual Rows"]),
			actualLoops: number(raw["Actual Loops"]),
			rowsRemovedByFilter: number(raw["Rows Removed by Filter"]),
			rowsRemovedByJoinFilter: number(raw["Rows Removed by Join Filter"]),
			heapFetches: number(raw["Heap Fetches"]),
			shared: blocks(raw, "Shared"),
			local: blocks(raw, "Local"),
			temp: blocks(raw, "Temp"),
			ioReadTime: number(raw["I/O Read Time"]),
			ioWriteTime: number(raw["I/O Write Time"]),
			sortSpaceUsed: number(raw["Sort Space Used"]),
			sortSpaceType: text(raw["Sort Space Type"]),
			hashBuckets: number(raw["Hash Buckets"]),
			hashBatches: number(raw["Hash Batches"]),
			originalHashBatches: number(raw["Original Hash Batches"]),
			peakMemoryUsage: number(raw["Peak Memory Usage"]),
			parallelAware: bool(raw["Parallel Aware"]),
			workersPlanned: number(raw["Workers Planned"]),
			workersLaunched: number(raw["Workers Launched"]),
			workers: workers(raw.Workers),
			raw: { ...raw },
		});
		for (let index = children.length - 1; index >= 0; index--) {
			stack.push({
				raw: children[index],
				parentId: id,
				depth: current.depth + 1,
				path: [...current.path, index],
			});
		}
	}
	const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
	const analyzed =
		number(top["Execution Time"]) !== undefined ||
		nodes.some((node) => node.actualRows !== undefined);
	const hasBuffers = nodes.some(
		(node) => node.shared || node.local || node.temp,
	);
	return {
		database: "postgresql",
		rootId: "plan-0",
		nodes,
		nodeById,
		maxDepth: Math.max(...nodes.map((node) => node.depth)),
		analyzed,
		hasBuffers,
		planningTime: number(top["Planning Time"]),
		executionTime: number(top["Execution Time"]),
		jit: object(top.JIT) ? { ...top.JIT } : undefined,
		triggers: Array.isArray(top.Triggers)
			? top.Triggers.filter(object).map((item) => ({ ...item }))
			: [],
		raw: { ...top },
	};
}
