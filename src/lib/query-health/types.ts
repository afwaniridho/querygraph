import type { Node } from "@xyflow/react";
import type { Dialect } from "#/lib/dialect";
import type { SourceSpan } from "#/lib/pipeline";
import type { SchemaModel } from "#/lib/schema/schema";

export type HealthSeverity = "info" | "warning" | "danger";
export type HealthConfidence = "definite" | "high" | "estimate";
export type HealthEvidenceKind = "query-structure" | "schema" | "heuristic";
export type HealthCategory =
	| "correctness"
	| "safety"
	| "performance"
	| "determinism"
	| "maintainability"
	| "portability";

export type HealthRuleId =
	| "select-star"
	| "limit-without-order"
	| "cartesian-join"
	| "update-without-where"
	| "delete-without-where"
	| "leading-wildcard-like"
	| "indexed-column-expression"
	| "left-join-filtered-in-where"
	| "composite-index-prefix"
	| "estimated-full-scan"
	| "null-comparison"
	| "not-in-with-null"
	| "tautological-write-filter"
	| "offset-pagination"
	| "random-order"
	| "redundant-distinct"
	| "non-grouped-select"
	| "not-null-is-null"
	| "limit-order-ties"
	| "join-may-duplicate"
	| "destructive-ddl"
	| "insert-without-columns"
	| "nullable-not-in-subquery"
	| "distinct-on-order";

export interface HealthFinding {
	ruleId: HealthRuleId;
	severity: HealthSeverity;
	title: string;
	evidence: string;
	explanation: string;
	remediation: string;
	sourceSpan?: SourceSpan;
	nodeId?: string;
	dialects: readonly Dialect[];
	requiresDdl?: boolean;
	confidence: HealthConfidence;
	evidenceKind: HealthEvidenceKind;
	category: HealthCategory;
}

export interface HealthContext {
	sql: string;
	dialect: Dialect;
	nodes: Node[];
	schema?: SchemaModel;
}

export interface HealthRule {
	id: HealthRuleId;
	dialects: readonly Dialect[];
	evaluate(context: HealthContext): HealthFinding[];
}
