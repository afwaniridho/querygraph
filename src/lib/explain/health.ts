import {
	estimateRatio,
	filteringPercent,
	formatNumber,
	totalActualRows,
	totalActualTime,
} from "./metrics";
import type { ExecutionPlan, PlanFinding, PlanNode } from "./types";

const finding = (
	node: PlanNode,
	value: Omit<PlanFinding, "nodeId">,
): PlanFinding => ({ ...value, nodeId: node.id });

export function analyzePlan(plan: ExecutionPlan): PlanFinding[] {
	if (plan.database === "mysql") return analyzeMysqlPlan(plan);
	const results: PlanFinding[] = [];
	for (const node of plan.nodes) {
		const ratio = estimateRatio(node);
		if (
			ratio !== undefined &&
			ratio >= 10 &&
			Math.max(node.actualRows ?? 0, node.planRows ?? 0) >= 100
		) {
			const underestimate = (node.actualRows ?? 0) > (node.planRows ?? 0);
			results.push(
				finding(node, {
					ruleId: "cardinality-mismatch",
					severity: ratio >= 100 ? "danger" : "warning",
					title: `Cardinality ${underestimate ? "underestimate" : "overestimate"}`,
					evidence: `${formatNumber(node.planRows ?? 0)} estimated vs ${formatNumber(node.actualRows ?? 0)} actual rows per loop (${formatNumber(ratio)}× difference).`,
					explanation:
						"The plan shows a material row-estimate mismatch. Estimates influence join order, join algorithms, and memory decisions; looped values are compared per loop.",
					suggestions: [
						"Check statistics freshness and data skew.",
						"Inspect correlations between filtered columns and consider extended statistics.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		const filtered = filteringPercent(node);
		const scanned = (node.actualRows ?? 0) + (node.rowsRemovedByFilter ?? 0);
		if (filtered !== undefined && filtered >= 80 && scanned >= 10_000) {
			results.push(
				finding(node, {
					ruleId: "large-filtering-loss",
					severity: filtered >= 95 ? "danger" : "warning",
					title: "Large filtering loss",
					evidence: `${formatNumber(node.rowsRemovedByFilter ?? 0)} rows removed (${formatNumber(filtered)}% per loop).`,
					explanation:
						"The operation examined substantially more rows than it returned.",
					suggestions: [
						"Check whether the predicate can be applied by an existing access path.",
						"Review predicate selectivity and table statistics.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		const joinFiltered = filteringPercent(node, true);
		const joinWork =
			(node.actualRows ?? 0) + (node.rowsRemovedByJoinFilter ?? 0);
		if (
			joinFiltered !== undefined &&
			joinFiltered >= 80 &&
			joinWork >= 10_000
		) {
			results.push(
				finding(node, {
					ruleId: "join-filter-loss",
					severity: joinFiltered >= 95 ? "danger" : "warning",
					title: "Join filter removes many rows",
					evidence: `${formatNumber(node.rowsRemovedByJoinFilter ?? 0)} candidate rows removed (${formatNumber(joinFiltered)}% per loop).`,
					explanation:
						"The join produced or considered many row combinations that its join filter discarded.",
					suggestions: [
						"Inspect join predicates and whether selective conditions can be applied earlier.",
						"Check estimates on both join inputs.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		const repeatedTime = totalActualTime(node);
		if (
			(node.actualLoops ?? 0) >= 100 &&
			(repeatedTime ?? 0) >= 100 &&
			node.parentId
		) {
			results.push(
				finding(node, {
					ruleId: "repeated-inner-operation",
					severity: (repeatedTime ?? 0) >= 1_000 ? "danger" : "warning",
					title: "Expensive repeated operation",
					evidence: `${formatNumber(node.actualLoops ?? 0)} loops at ${formatNumber(node.actualTotalTime ?? 0)} ms average inclusive time (${formatNumber(repeatedTime ?? 0)} ms loop-aware).`,
					explanation:
						"This operation repeats substantial work. The loop-aware figure is derived and is not added to parent inclusive time.",
					suggestions: [
						"Inspect the parent join and why this input is rescanned.",
						"Check whether memoization, a different join strategy, or a more selective access path is feasible.",
					],
					requiresActual: true,
					confidence: "medium",
				}),
			);
		}
		const sortMethod = node.sortMethod?.toLowerCase() ?? "";
		if (
			sortMethod.includes("external") ||
			node.sortSpaceType?.toLowerCase() === "disk"
		) {
			results.push(
				finding(node, {
					ruleId: "sort-spill",
					severity: "warning",
					title: "Sort used disk",
					evidence: `${node.sortMethod ?? "Disk sort"}${node.sortSpaceUsed !== undefined ? ` · ${formatNumber(node.sortSpaceUsed)} kB ${node.sortSpaceType ?? ""}` : ""}.`,
					explanation:
						"The plan explicitly reports a disk-backed sort, which can add temporary I/O.",
					suggestions: [
						"Confirm whether the spill is material for this workload.",
						"Review work_mem carefully at the appropriate scope and reduce rows before sorting where possible.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		const tempIo = (node.temp?.read ?? 0) + (node.temp?.written ?? 0);
		const isHashOperation = node.nodeType.toLowerCase().includes("hash");
		if ((node.hashBatches ?? 1) > 1 || (isHashOperation && tempIo > 0)) {
			results.push(
				finding(node, {
					ruleId: "hash-batching",
					severity: "warning",
					title: "Hash operation used multiple batches",
					evidence: `${node.hashBatches ?? 1} hash batches${tempIo ? ` and ${formatNumber(tempIo)} temporary blocks` : ""}.`,
					explanation:
						"Multiple batches or temporary I/O indicate that the hash operation may have exceeded its preferred memory footprint.",
					suggestions: [
						"Check input cardinality estimates and row width.",
						"Review memory settings only after confirming concurrency and workload impact.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		const workload = totalActualRows(node) ?? node.planRows ?? 0;
		if (node.nodeType === "Seq Scan" && workload >= 100_000) {
			results.push(
				finding(node, {
					ruleId: "high-seq-scan-workload",
					severity: "info",
					title: "High sequential-scan workload",
					evidence: `${formatNumber(workload)} ${node.actualRows !== undefined ? "actual loop-aware" : "estimated"} rows returned or processed.`,
					explanation:
						"A sequential scan over a large workload is worth reviewing, but can be the optimal choice when much of a table is needed.",
					suggestions: [
						"Compare rows returned with table size and query frequency.",
						"Check selective predicates and available indexes; do not assume an index is better.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (
			node.heapFetches !== undefined &&
			node.actualRows !== undefined &&
			node.actualRows >= 1_000 &&
			node.heapFetches > node.actualRows * 0.5
		) {
			results.push(
				finding(node, {
					ruleId: "heap-fetches",
					severity: "info",
					title: "Many heap fetches",
					evidence: `${formatNumber(node.heapFetches)} heap fetches for ${formatNumber(node.actualRows)} rows per loop.`,
					explanation:
						"An index-only scan still visited the heap frequently, reducing the benefit of index-only access.",
					suggestions: [
						"Inspect visibility-map coverage and vacuum behavior.",
						"Confirm this is a recurring workload before tuning maintenance.",
					],
					requiresActual: true,
					confidence: "high",
				}),
			);
		}
		if (node.workers.length >= 2) {
			const rows = node.workers
				.map((worker) => worker.actualRows)
				.filter((value): value is number => value !== undefined);
			if (rows.length >= 2) {
				const max = Math.max(...rows);
				const min = Math.min(...rows);
				if (max >= 10_000 && max / Math.max(min, 1) >= 3) {
					results.push(
						finding(node, {
							ruleId: "parallel-worker-imbalance",
							severity: "warning",
							title: "Parallel worker imbalance",
							evidence: `Per-worker rows range from ${formatNumber(min)} to ${formatNumber(max)}.`,
							explanation:
								"The available worker detail shows a strong workload imbalance, which can limit parallel speedup.",
							suggestions: [
								"Check data skew and partitioning of work.",
								"Compare leader participation and worker timing.",
							],
							requiresActual: true,
							confidence: "medium",
						}),
					);
				}
			}
		}
	}
	const root = plan.nodeById[plan.rootId];
	if (
		root &&
		(plan.planningTime ?? 0) >= 10 &&
		(plan.executionTime ?? 0) > 0 &&
		(plan.planningTime ?? 0) >= (plan.executionTime ?? 0) * 2
	) {
		results.push(
			finding(root, {
				ruleId: "planning-dominates",
				severity: "info",
				title: "Planning time dominates execution",
				evidence: `${formatNumber(plan.planningTime ?? 0)} ms planning vs ${formatNumber(plan.executionTime ?? 0)} ms execution.`,
				explanation:
					"For this captured run, planning took materially longer than execution.",
				suggestions: [
					"Confirm the pattern across repeated executions.",
					"Consider prepared statements where workload semantics permit.",
				],
				requiresActual: true,
				confidence: "high",
			}),
		);
	}
	const rank = { danger: 0, warning: 1, info: 2 };
	return results.sort(
		(a, b) =>
			rank[a.severity] - rank[b.severity] ||
			a.ruleId.localeCompare(b.ruleId) ||
			a.nodeId.localeCompare(b.nodeId),
	);
}

function estimatedWork(node: PlanNode): number {
	return Math.max(node.rowsExaminedPerScan ?? 0, node.rowsProducedPerJoin ?? 0);
}

function isLargeMysqlWork(node: PlanNode): boolean {
	return estimatedWork(node) >= 100_000;
}

function mysqlEvidence(node: PlanNode): string {
	const parts = [];
	if (node.rowsExaminedPerScan !== undefined) {
		parts.push(
			`${formatNumber(node.rowsExaminedPerScan)} rows examined per scan`,
		);
	}
	if (node.rowsProducedPerJoin !== undefined) {
		parts.push(
			`${formatNumber(node.rowsProducedPerJoin)} rows produced per join`,
		);
	}
	if (node.filtered !== undefined) {
		parts.push(`${formatNumber(node.filtered)}% filtered`);
	}
	return parts.join(" · ") || "MySQL JSON fields on this plan node.";
}

function analyzeMysqlPlan(plan: ExecutionPlan): PlanFinding[] {
	const results: PlanFinding[] = [];
	const rootCost = plan.nodes
		.map((node) => node.queryCost)
		.find((value): value is number => value !== undefined && value > 0);
	for (const node of plan.nodes) {
		const work = estimatedWork(node);
		const largeWork = isLargeMysqlWork(node);
		if (node.accessType === "ALL" && largeWork) {
			results.push(
				finding(node, {
					ruleId: "mysql-high-full-scan-workload",
					severity:
						work >= 1_000_000 ||
						(node.attachedCondition && (node.filtered ?? 100) <= 25)
							? "warning"
							: "info",
					title: "High full-scan workload",
					evidence: `access_type=ALL · ${mysqlEvidence(node)}.`,
					explanation:
						"This table access is a full scan over a large estimated workload. That can be correct when much of the table is needed, but it is worth reviewing for frequent queries.",
					suggestions: [
						"Compare the estimated scan size with table size and query frequency.",
						"Check whether selective predicates can use an existing access path.",
						"Confirm with MySQL EXPLAIN/ANALYZE and workload data.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (node.filtered !== undefined && node.filtered <= 10 && largeWork) {
			results.push(
				finding(node, {
					ruleId: "mysql-low-filtered-large-scan",
					severity: "warning",
					title: "Low filtered percentage on large scan",
					evidence: `MySQL estimates ${formatNumber(node.rowsExaminedPerScan ?? work)} rows examined per scan and ${formatNumber(node.filtered)}% passed the table condition.`,
					explanation:
						"The plan estimates that a small share of a large scanned input passes the table condition.",
					suggestions: [
						"Check whether predicates are selective.",
						"Check whether an existing index can support the condition.",
						"Confirm with production statistics and real workload.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (node.usingFilesort) {
			results.push(
				finding(node, {
					ruleId: "mysql-filesort",
					severity: largeWork ? "warning" : "info",
					title: "Filesort reported",
					evidence: `using_filesort=true${work ? ` · ${mysqlEvidence(node)}` : ""}.`,
					explanation:
						"MySQL reports filesort for this ordering step. Filesort is not always disk I/O, but it can become expensive for large inputs.",
					suggestions: [
						"Check whether the ORDER BY can be satisfied by the chosen access path.",
						"Review the estimated input size before changing indexes or query shape.",
					],
					requiresActual: false,
					confidence: "high",
				}),
			);
		}
		if (node.usingTemporaryTable) {
			results.push(
				finding(node, {
					ruleId: "mysql-temporary-table",
					severity: largeWork ? "warning" : "info",
					title: "Temporary table reported",
					evidence: `using_temporary_table=true${work ? ` · ${mysqlEvidence(node)}` : ""}.`,
					explanation:
						"MySQL reports a temporary table for this operation. This can be normal for GROUP BY, DISTINCT, or complex ordering, but large intermediate results are worth checking.",
					suggestions: [
						"Inspect GROUP BY, DISTINCT, and ORDER BY clauses for this operation.",
						"Confirm whether the intermediate result is large in production.",
					],
					requiresActual: false,
					confidence: "high",
				}),
			);
		}
		if ((node.possibleKeys?.length ?? 0) > 0 && !node.key && largeWork) {
			results.push(
				finding(node, {
					ruleId: "mysql-possible-keys-not-chosen",
					severity: "info",
					title: "Possible keys not chosen",
					evidence: `possible_keys=${node.possibleKeys?.join(", ")} · key not chosen · ${mysqlEvidence(node)}.`,
					explanation:
						"MySQL lists possible keys but did not choose one for this table access.",
					suggestions: [
						"Compare predicate selectivity with the available keys.",
						"Check statistics freshness and whether the optimizer expects a scan to be cheaper.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (
			(!node.possibleKeys || node.possibleKeys.length === 0) &&
			node.attachedCondition &&
			largeWork &&
			(node.filtered ?? 100) <= 10
		) {
			results.push(
				finding(node, {
					ruleId: "mysql-no-possible-keys-filtered-scan",
					severity: "warning",
					title: "No possible keys for filtered scan",
					evidence: `No possible_keys · ${mysqlEvidence(node)} · attached_condition present.`,
					explanation:
						"The plan shows a large filtered scan and no possible keys for this table access. An index may be worth investigating if this query is frequent and selective.",
					suggestions: [
						"Confirm that the condition is selective for production data.",
						"Review whether an existing index can support the filtered columns.",
						"Avoid adding index DDL until workload frequency and write cost are clear.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (
			rootCost !== undefined &&
			node.prefixCost !== undefined &&
			node.prefixCost >= rootCost * 0.5 &&
			node.id !== plan.rootId
		) {
			results.push(
				finding(node, {
					ruleId: "mysql-large-prefix-cost-share",
					severity: "info",
					title: "Large share of estimated cost",
					evidence: `prefix_cost=${formatNumber(node.prefixCost)} of root query_cost=${formatNumber(rootCost)}.`,
					explanation:
						"This access accounts for a large share of the estimated query cost.",
					suggestions: [
						"Inspect whether this access path dominates the plan cost.",
						"Validate the estimate with MySQL statistics and representative workload data.",
					],
					requiresActual: false,
					confidence: "medium",
				}),
			);
		}
		if (node.materializedFromSubquery) {
			results.push(
				finding(node, {
					ruleId: "mysql-materialized-subquery",
					severity: "info",
					title: "Materialized subquery",
					evidence:
						"materialized_from_subquery is present on this table access.",
					explanation:
						"MySQL materializes this subquery. That can be useful, but large materialized results can add memory or temporary-table work.",
					suggestions: [
						"Check the estimated rows produced by the subquery.",
						"Confirm whether materialization is repeated or materially expensive for the workload.",
					],
					requiresActual: false,
					confidence: "high",
				}),
			);
		}
	}
	const rank = { danger: 0, warning: 1, info: 2 };
	return results.sort(
		(a, b) =>
			rank[a.severity] - rank[b.severity] ||
			a.ruleId.localeCompare(b.ruleId) ||
			a.nodeId.localeCompare(b.nodeId),
	);
}
