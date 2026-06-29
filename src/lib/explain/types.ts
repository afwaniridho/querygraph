export type PlanSeverity = "info" | "warning" | "danger";
export type PlanDatabase = "postgresql" | "mysql";

export interface BlockMetrics {
	hit?: number;
	read?: number;
	dirtied?: number;
	written?: number;
}

export interface PlanWorker {
	number?: number;
	actualStartupTime?: number;
	actualTotalTime?: number;
	actualRows?: number;
	actualLoops?: number;
	raw: Record<string, unknown>;
}

export interface PlanNode {
	id: string;
	parentId: string | null;
	childIds: string[];
	depth: number;
	database?: PlanDatabase;
	nodeType: string;
	parentRelationship?: string;
	joinType?: string;
	scanDirection?: string;
	relationName?: string;
	schema?: string;
	alias?: string;
	indexName?: string;
	hashCondition?: string;
	joinFilter?: string;
	filter?: string;
	indexCondition?: string;
	recheckCondition?: string;
	sortKey?: string[];
	sortMethod?: string;
	groupKey?: string[];
	strategy?: string;
	operation?: string;
	subplanName?: string;
	cteName?: string;
	startupCost?: number;
	totalCost?: number;
	planRows?: number;
	planWidth?: number;
	actualStartupTime?: number;
	actualTotalTime?: number;
	actualRows?: number;
	actualLoops?: number;
	rowsRemovedByFilter?: number;
	rowsRemovedByJoinFilter?: number;
	heapFetches?: number;
	shared?: BlockMetrics;
	local?: BlockMetrics;
	temp?: BlockMetrics;
	ioReadTime?: number;
	ioWriteTime?: number;
	sortSpaceUsed?: number;
	sortSpaceType?: string;
	hashBuckets?: number;
	hashBatches?: number;
	originalHashBatches?: number;
	peakMemoryUsage?: number;
	parallelAware?: boolean;
	workersPlanned?: number;
	workersLaunched?: number;
	workers: PlanWorker[];
	tableName?: string;
	accessType?: string;
	possibleKeys?: string[];
	key?: string;
	usedKeyParts?: string[];
	keyLength?: string;
	ref?: string[];
	rowsExaminedPerScan?: number;
	rowsProducedPerJoin?: number;
	filtered?: number;
	attachedCondition?: string;
	usingIndex?: boolean;
	usingTemporaryTable?: boolean;
	usingFilesort?: boolean;
	readCost?: number;
	evalCost?: number;
	prefixCost?: number;
	dataReadPerJoin?: string;
	queryCost?: number;
	usedColumns?: string[];
	materializedFromSubquery?: boolean;
	normalized?: boolean;
	raw: Record<string, unknown>;
}

export interface ExecutionPlan {
	database: PlanDatabase;
	rootId: string;
	nodes: PlanNode[];
	nodeById: Record<string, PlanNode>;
	maxDepth: number;
	analyzed: boolean;
	hasBuffers: boolean;
	planningTime?: number;
	executionTime?: number;
	jit?: Record<string, unknown>;
	triggers: Record<string, unknown>[];
	raw: Record<string, unknown>;
}

export interface PlanFinding {
	ruleId: string;
	severity: PlanSeverity;
	title: string;
	nodeId: string;
	evidence: string;
	explanation: string;
	suggestions: string[];
	requiresActual: boolean;
	confidence: "high" | "medium";
}

export interface ParseLimits {
	maxInputBytes: number;
	maxNodes: number;
	maxDepth: number;
}

export class PlanParseError extends Error {
	constructor(
		public readonly code:
			| "empty"
			| "invalid-json"
			| "invalid-structure"
			| "missing-plan"
			| "too-large"
			| "too-many-nodes"
			| "too-deep",
		message: string,
		public readonly technicalDetail?: string,
	) {
		super(message);
	}
}
