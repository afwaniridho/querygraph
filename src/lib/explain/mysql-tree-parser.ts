import { PLAN_LIMITS } from "./parser";
import {
	type ExecutionPlan,
	type ParseLimits,
	type PlanNode,
	PlanParseError,
} from "./types";

const NUM = String.raw`[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?`;

const COST_RE = new RegExp(
	String.raw`\(cost=(${NUM})(?:\.\.(${NUM}))?\s+rows=(${NUM})\)`,
);
const ACTUAL_RE = new RegExp(
	String.raw`\(actual time=(${NUM})(?:\.\.(${NUM}))?\s+rows=(${NUM})\s+loops=(${NUM})\)`,
);
const NEVER_EXECUTED_RE = /\(never executed\)/;

const toNumber = (value: string | undefined): number | undefined => {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const EXPLAIN_PREFIX = "EXPLAIN:";

export function isMysqlTreeOutput(input: string): boolean {
	const trimmed = input.trim();
	if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return false;
	}
	return /(?:^|\n)\s*(?:EXPLAIN:\s*)?->\s+/.test(trimmed);
}

interface RawTreeNode {
	indent: number;
	label: string;
	startupCost?: number;
	totalCost?: number;
	planRows?: number;
	actualStartupTime?: number;
	actualTotalTime?: number;
	actualRows?: number;
	actualLoops?: number;
	line: string;
	continuations: string[];
}

function parseRawTreeNode(
	indent: number,
	content: string,
	line: string,
	continuations: string[] = [],
): RawTreeNode {
	const fullContent = [content, ...continuations].join(" ");
	const cost = parseCost(fullContent);
	const actual = parseActual(fullContent);
	return {
		indent,
		label: extractLabel(fullContent),
		...cost,
		...actual,
		line,
		continuations,
	};
}

function parseCost(
	line: string,
): Pick<RawTreeNode, "startupCost" | "totalCost" | "planRows"> {
	const match = line.match(COST_RE);
	if (!match) return {};
	const first = toNumber(match[1]);
	const second = toNumber(match[2]);
	return {
		startupCost: second !== undefined ? first : undefined,
		totalCost: second ?? first,
		planRows: toNumber(match[3]),
	};
}

function parseActual(
	line: string,
): Pick<
	RawTreeNode,
	"actualStartupTime" | "actualTotalTime" | "actualRows" | "actualLoops"
> {
	if (NEVER_EXECUTED_RE.test(line)) return {};
	const match = line.match(ACTUAL_RE);
	if (!match) return {};
	const first = toNumber(match[1]);
	const second = toNumber(match[2]);
	return {
		actualStartupTime: second !== undefined ? first : undefined,
		actualTotalTime: second ?? first,
		actualRows: toNumber(match[3]),
		actualLoops: toNumber(match[4]),
	};
}

function extractLabel(content: string): string {
	const costIndex = content.search(/\(cost=/);
	const actualIndex = content.search(/\(actual /);
	const neverIndex = content.search(/\(never executed\)/);
	let cut = content.length;
	for (const index of [costIndex, actualIndex, neverIndex]) {
		if (index >= 0 && index < cut) cut = index;
	}
	return content.slice(0, cut).trim();
}

const IDENTIFIER = String.raw`\`?[A-Za-z0-9_$.]+\`?`;
const ON_RE = new RegExp(String.raw`\bon (${IDENTIFIER})`);
const USING_RE = new RegExp(String.raw`\busing (${IDENTIFIER})`);

const unquote = (value: string) => value.replace(/`/g, "");

function extractAccessPath(label: string): {
	tableName?: string;
	key?: string;
} {
	const onMatch = label.match(ON_RE);
	const usingMatch = label.match(USING_RE);
	return {
		tableName: onMatch ? unquote(onMatch[1]) : undefined,
		key: usingMatch ? unquote(usingMatch[1]) : undefined,
	};
}

function readRawNodes(input: string, limits: ParseLimits): RawTreeNode[] {
	const normalized = input.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const nodes: RawTreeNode[] = [];

	for (const original of lines) {
		if (!original.trim()) continue;
		const expanded = original.replace(/\t/g, "    ");
		const indent = expanded.length - expanded.trimStart().length;
		let rest = expanded.slice(indent);
		if (rest.startsWith(EXPLAIN_PREFIX)) {
			rest = rest.slice(EXPLAIN_PREFIX.length).replace(/^\s*/, "");
		}
		if (!rest.startsWith("->")) {
			const previous = nodes.at(-1);
			if (previous) {
				previous.continuations.push(original.trim());
				Object.assign(
					previous,
					parseRawTreeNode(
						previous.indent,
						previous.line.trim().replace(/^(?:EXPLAIN:\s*)?->\s*/, ""),
						previous.line,
						previous.continuations,
					),
				);
			}
			continue;
		}
		const content = rest.slice(2).trim();
		nodes.push(parseRawTreeNode(indent, content, original));
		if (nodes.length > limits.maxNodes) {
			throw new PlanParseError(
				"too-many-nodes",
				`This MySQL plan exceeds the ${limits.maxNodes}-node limit.`,
			);
		}
	}

	return nodes;
}

function buildNode(
	raw: RawTreeNode,
	id: string,
	parentId: string | null,
	depth: number,
	childIds: string[],
): PlanNode {
	const access = extractAccessPath(raw.label);
	return {
		id,
		parentId,
		childIds,
		depth,
		database: "mysql",
		nodeType: raw.label || "Operation",
		relationName: access.tableName,
		alias: access.tableName,
		tableName: access.tableName,
		key: access.key,
		startupCost: raw.startupCost,
		totalCost: raw.totalCost,
		planRows: raw.planRows,
		actualStartupTime: raw.actualStartupTime,
		actualTotalTime: raw.actualTotalTime,
		actualRows: raw.actualRows,
		actualLoops: raw.actualLoops,
		workers: [],
		raw: {
			line: raw.line.trim(),
			label: raw.label,
			indent: raw.indent,
			continuations: raw.continuations,
		},
	};
}

export function parseMysqlTreePlan(
	input: string,
	limits: ParseLimits = PLAN_LIMITS,
): ExecutionPlan {
	if (!input.trim()) {
		throw new PlanParseError("empty", "Paste MySQL EXPLAIN output to begin.");
	}
	if (new TextEncoder().encode(input).byteLength > limits.maxInputBytes) {
		throw new PlanParseError(
			"too-large",
			`This MySQL plan exceeds the ${Math.round(limits.maxInputBytes / 1_000_000)} MB input limit.`,
		);
	}

	const rawNodes = readRawNodes(input, limits);
	if (rawNodes.length === 0) {
		throw new PlanParseError(
			"missing-plan",
			"No MySQL TREE nodes were found. EXPLAIN ANALYZE rows begin with '->'.",
		);
	}

	const nodes: PlanNode[] = [];
	const stack: Array<{
		indent: number;
		id: string;
		path: number[];
		childCount: number;
	}> = [];
	const childIdsByParent = new Map<string, string[]>();

	for (const raw of rawNodes) {
		while (stack.length && stack[stack.length - 1].indent >= raw.indent) {
			stack.pop();
		}
		const parent = stack[stack.length - 1];
		const depth = stack.length;
		if (depth > limits.maxDepth) {
			throw new PlanParseError(
				"too-deep",
				`This MySQL plan exceeds the maximum depth of ${limits.maxDepth}.`,
			);
		}
		if (!parent && nodes.length > 0) {
			throw new PlanParseError(
				"invalid-structure",
				"This MySQL TREE plan has multiple root nodes, which is not supported.",
			);
		}
		const siblingIndex = parent ? parent.childCount : 0;
		const path = parent ? [...parent.path, siblingIndex] : [0];
		const id = `plan-${path.join("-")}`;
		if (parent) {
			parent.childCount += 1;
			const siblings = childIdsByParent.get(parent.id) ?? [];
			siblings.push(id);
			childIdsByParent.set(parent.id, siblings);
		}
		const node = buildNode(raw, id, parent?.id ?? null, depth, []);
		nodes.push(node);
		stack.push({ indent: raw.indent, id, path, childCount: 0 });
	}

	for (const node of nodes) {
		node.childIds = childIdsByParent.get(node.id) ?? [];
	}

	const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
	return {
		database: "mysql",
		rootId: nodes[0].id,
		nodes,
		nodeById,
		maxDepth: Math.max(...nodes.map((node) => node.depth)),
		analyzed: nodes.some((node) => node.actualRows !== undefined),
		hasBuffers: false,
		triggers: [],
		raw: { format: "tree", text: input },
	};
}
