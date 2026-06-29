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
